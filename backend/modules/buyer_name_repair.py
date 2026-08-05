"""Repair buyers whose company_name is actually a location (city/country/address).

Moves the misplaced value into city / country / address, then recovers a real
company name from website title, domain brand, CompanyLens, contact email
domain, phone search, or LinkedIn slug. If no name can be found, company_name
becomes an empty string (allowed for sparse table rows).
"""

from __future__ import annotations

import logging
import re
import time
from typing import Any
from urllib.parse import urlparse

import httpx
from sqlalchemy.orm import Session

from db.models import Buyer, Contact
from modules.countries import resolve_country_name
from modules import buyers as buyers_module

logger = logging.getLogger(__name__)

# Strong postal cues only — omit industrial/warehouse/zone (common in company names).
_STREET_HINT_RE = re.compile(
    r"\b(street|st\.|road|rd\.|avenue|ave\.|blvd\.?|boulevard|lane|ln\.|"
    r"drive|dr\.|suite|ste\.|floor|fl\.|building|bldg\.?|unit|plot|"
    r"p\.?\s*o\.?\s*box|po box)\b",
    re.I,
)
# UK outward+inward postcodes: W1K 4QY, EN1 1DZ, SW1A 1AA, EC1A 1BB, M1 1AE…
_UK_POSTCODE_RE = re.compile(
    r"\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b",
    re.I,
)
# US ZIP (5 or ZIP+4) — only used with a place name, not alone (avoids random numbers).
_US_ZIP_RE = re.compile(r"\b(\d{5})(?:-\d{4})?\b")
# Common UK counties / areas that appear instead of company names (with postcodes).
_UK_COUNTIES = {
    "middlesex",
    "surrey",
    "essex",
    "kent",
    "hertfordshire",
    "herts",
    "bedfordshire",
    "beds",
    "berkshire",
    "berks",
    "buckinghamshire",
    "bucks",
    "oxfordshire",
    "oxon",
    "hampshire",
    "hants",
    "sussex",
    "east sussex",
    "west sussex",
    "dorset",
    "devon",
    "cornwall",
    "somerset",
    "wiltshire",
    "gloucestershire",
    "glos",
    "worcestershire",
    "worcs",
    "warwickshire",
    "warks",
    "staffordshire",
    "staffs",
    "shropshire",
    "salop",
    "cheshire",
    "lancashire",
    "lancs",
    "yorkshire",
    "north yorkshire",
    "south yorkshire",
    "west yorkshire",
    "east yorkshire",
    "durham",
    "cumbria",
    "northumberland",
    "nottinghamshire",
    "notts",
    "derbyshire",
    "leicestershire",
    "leics",
    "lincolnshire",
    "lincs",
    "norfolk",
    "suffolk",
    "cambridgeshire",
    "cambs",
    "greater london",
    "greater manchester",
    "west midlands",
    "merseyside",
    "tyne and wear",
    "glasgow",
    "edinburgh",
    "cardiff",
    "belfast",
    "bristol",
    "leeds",
    "sheffield",
    "liverpool",
    "newcastle",
    "brighton",
    "reading",
    "oxford",
    "cambridge",
    "enfield",
    "croydon",
    "romford",
    "ilford",
    "slough",
    "watford",
    "luton",
}
_COMPANY_SUFFIX_RE = re.compile(
    r"\b(llc|l\.l\.c|ltd|limited|inc|incorporated|corp|corporation|gmbh|"
    r"pte|pvt|trading|foods|food|group|international|co\.?|company|"
    r"enterprises|imports|exports|distributors?|wholesale|holdings?|"
    r"hypermarket|supermarket|warehouse|companhia)\b",
    re.I,
)
# Short aliases only — do NOT treat every ISO code (ARIA→BG, Swan→BW) as a country.
_STRICT_COUNTRY_ALIASES = {
    "uae",
    "uk",
    "usa",
    "us",
    "u.s.",
    "u.s.a.",
    "ksa",
    "rsa",
    "rok",
    "prc",
    "ua",
    "gb",
    "u.k.",
}
_FREE_EMAIL_DOMAINS = {
    "gmail.com",
    "yahoo.com",
    "yahoo.co.uk",
    "hotmail.com",
    "outlook.com",
    "live.com",
    "icloud.com",
    "aol.com",
    "mail.com",
    "proton.me",
    "protonmail.com",
    "gmx.com",
    "yandex.com",
}
# Frequent importer markets — used as city heuristics when company_name equals these.
_KNOWN_CITIES = {
    "dubai",
    "abu dhabi",
    "sharjah",
    "ajman",
    "ras al khaimah",
    "fujairah",
    "umm al quwain",
    "al ain",
    "riyadh",
    "jeddah",
    "dammam",
    "khobar",
    "mecca",
    "medina",
    "doha",
    "kuwait",
    "kuwait city",
    "manama",
    "muscat",
    "salalah",
    "amman",
    "cairo",
    "alexandria",
    "lagos",
    "nairobi",
    "johannesburg",
    "cape town",
    "durban",
    "karachi",
    "lahore",
    "islamabad",
    "singapore",
    "kuala lumpur",
    "jakarta",
    "bangkok",
    "ho chi minh",
    "hanoi",
    "manila",
    "london",
    "manchester",
    "birmingham",
    "rotterdam",
    "amsterdam",
    "hamburg",
    "berlin",
    "frankfurt",
    "paris",
    "marseille",
    "madrid",
    "barcelona",
    "milan",
    "rome",
    "toronto",
    "vancouver",
    "montreal",
    "new york",
    "los angeles",
    "houston",
    "chicago",
    "miami",
    "sydney",
    "melbourne",
    "perth",
    "auckland",
}


def _norm(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "").strip())


def _norm_key(text: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").lower()).strip()


def _has_company_suffix(text: str) -> bool:
    return bool(_COMPANY_SUFFIX_RE.search(text or ""))


def _strict_country_name(text: str | None) -> str | None:
    """Resolve only when ``text`` is a real country name or a known short alias."""
    t = _norm(text)
    if not t or len(t) < 2:
        return None
    country = resolve_country_name(t)
    if not country:
        return None
    if _norm_key(t) == _norm_key(country):
        return country
    compact = re.sub(r"[^a-z.]", "", t.lower())
    if compact in _STRICT_COUNTRY_ALIASES:
        return country
    return None


def _uk_postcode_in(text: str) -> str | None:
    m = _UK_POSTCODE_RE.search(text or "")
    if not m:
        return None
    raw = re.sub(r"\s+", " ", m.group(1).upper().strip())
    # Normalise to "OUTWARD INWARD"
    if " " not in raw and len(raw) >= 5:
        raw = f"{raw[:-3]} {raw[-3:]}"
    return raw


def _place_before_postcode(text: str, postcode: str) -> str | None:
    """Text before a UK postcode, e.g. 'London' from 'London, W1K 4QY'."""
    t = _norm(text)
    # Strip the postcode (with optional comma/space before it)
    pattern = re.compile(
        r"[,\s]*" + re.escape(postcode).replace(r"\ ", r"\s*") + r"\s*$",
        re.I,
    )
    left = pattern.sub("", t).strip(" ,;-")
    left = re.sub(r"\s+", " ", left).strip()
    if not left or len(left) < 2 or len(left) > 60:
        return None
    if _has_company_suffix(left):
        return None
    return left


def _looks_like_street_address(text: str) -> bool:
    """True for postal-looking strings (street cues or UK postcodes)."""
    t = _norm(text)
    if len(t) < 5:
        return False

    # UK postcode alone or with place: "W1K 4QY", "London, W1K 4QY", "Middlesex EN1 1DZ"
    if _uk_postcode_in(t):
        if _has_company_suffix(t) and not re.match(r"^\d", t):
            # "Acme Foods Ltd, London SW1A 1AA" — keep as company
            return False
        return True

    if len(t) < 10:
        return False
    if not re.search(r"\d", t):
        return False
    if not _STREET_HINT_RE.search(t):
        return False
    # "Dana Hypermarket - Salwa Road" / "Cargill … Road Safety" — business, not address
    if _has_company_suffix(t) and not re.match(r"^\d", t):
        return False
    if re.search(
        r"\b(hypermarket|supermarket|incorporated|corporation|prototyping|"
        r"application|safety|industrial)\b",
        t,
        re.I,
    ) and not re.match(r"^\d", t):
        return False
    # Prefer starting with a number / PO Box, or containing a clear street number pattern
    if re.match(r"^(?:p\.?\s*o\.?\s*box|po box)\b", t, re.I):
        return True
    if re.match(r"^\d", t):
        return True
    # "Unit 1, …" / "Suite 200 …"
    if re.match(r"^(?:unit|suite|ste\.?|plot|building|bldg\.?)\s*\d", t, re.I):
        return True
    # Embedded house number before street word: "… 12 Industrial Road …"
    if re.search(
        r"\b\d{1,5}[A-Za-z]?\s+[A-Za-z].{0,40}\b(?:street|st\.|road|rd\.|avenue|ave\.|"
        r"blvd|boulevard|lane|ln\.|drive|dr\.)\b",
        t,
        re.I,
    ):
        return True
    return False


def _domain_from_url(url: str | None) -> str | None:
    if not (url or "").strip():
        return None
    raw = url.strip()
    if "://" not in raw:
        raw = f"https://{raw}"
    try:
        host = urlparse(raw).netloc.lower()
    except Exception:
        return None
    if host.startswith("www."):
        host = host[4:]
    return host or None


def _brand_from_domain(domain: str | None) -> str | None:
    if not domain or "." not in domain:
        return None
    label = domain.split(".")[0].strip().lower()
    if not label or label in {"www", "mail", "email", "webmail", "smtp", "imap", "ftp"}:
        return None
    if label.isdigit() or len(label) < 3:
        return None
    parts = [p for p in re.split(r"[-_]+", label) if p]
    if not parts:
        return None
    return " ".join(p.capitalize() for p in parts)[:120]


_JUNK_RECOVERED_NAMES = {
    "n/a",
    "na",
    "none",
    "null",
    "unknown",
    "-",
    "company",
    "home",
    "homepage",
    "welcome",
    "index",
    "untitled",
    "login",
    "sign in",
    "contact",
    "about",
    "about us",
    "official site",
    "official website",
}


def _is_plausible_recovered_name(name: str | None, *, bad_location: str | None = None) -> bool:
    text = _norm(name)
    if len(text) < 2 or len(text) > 120:
        return False
    if text.lower() in _JUNK_RECOVERED_NAMES:
        return False
    if text.lower().startswith(("http://", "https://", "www.")):
        return False
    if "@" in text:
        return False
    if bad_location and _norm_key(text) == _norm_key(bad_location):
        return False
    # Reject pure locations as recovered "names"
    if classify_location_name(text) is not None and not _has_company_suffix(text):
        return False
    return True


def _name_from_building_label(text: str | None) -> str | None:
    """Pull a brand from labels like 'Unit 1, Veetee House'."""
    t = _norm(text)
    if not t:
        return None
    m = re.search(
        r"(?:^|,\s*)([A-Z][A-Za-z0-9&.'-]{2,40})\s+(?:House|Building|Centre|Center|Tower)\b",
        t,
    )
    if not m:
        return None
    name = m.group(1).strip(" ,.")
    if _is_plausible_recovered_name(name, bad_location=t):
        return name
    return None


def classify_location_name(raw: str | None) -> dict[str, Any] | None:
    """If ``raw`` looks like a location (not a company), return relocation fields.

    Conservative on purpose: short brand names (HANOS, Bayara, Puratos) must NOT
    be treated as cities. Only known cities, country labels, clear street addresses,
    or ``KnownCity, Country`` pairs qualify.
    """
    text = _norm(raw)
    if len(text) < 2:
        return None
    if _has_company_suffix(text):
        return None
    # Person / title cues — keep as company/contact, not location
    if re.match(r"^(dr|mr|mrs|ms|prof)\b", text, re.I):
        return None
    # Domain-like company handles
    if "." in text and re.search(r"\.[a-z]{2,}$", text, re.I):
        return None

    key = _norm_key(text)

    # Known city list (Dubai etc.)
    if key in _KNOWN_CITIES:
        return {
            "kind": "city",
            "city": text[:255],
            "country": None,
            "address": None,
        }

    # Pure country (strict — avoids ARIA/Swan/PT false positives)
    country_only = _strict_country_name(text)
    if country_only:
        return {
            "kind": "country",
            "country": country_only,
            "city": None,
            "address": None,
        }

    # Clear street / postal address (incl. UK postcodes like "London, W1K 4QY")
    if _looks_like_street_address(text):
        from modules.lead_discovery import _parse_city_from_address

        city = _parse_city_from_address(text)
        parts = [p.strip() for p in text.split(",") if p.strip()]
        country = _strict_country_name(parts[-1]) if parts else None
        uk_pc = _uk_postcode_in(text)
        if uk_pc:
            country = country or "United Kingdom"
            place = _place_before_postcode(text, uk_pc)
            if place:
                place_key = _norm_key(place)
                if place_key in _KNOWN_CITIES or place_key in _UK_COUNTIES:
                    city = place
                elif not city and len(place.split()) <= 4 and not re.search(r"\d", place):
                    city = place
        if city and (
            _norm_key(city) not in _KNOWN_CITIES
            and _norm_key(city) not in _UK_COUNTIES
            and not uk_pc
        ):
            city = None
        return {
            "kind": "address",
            "address": text[:500],
            "city": city,
            "country": country,
        }

    # Bare UK county / area name (no company suffix)
    if key in _UK_COUNTIES:
        return {
            "kind": "city",
            "city": text[:255],
            "country": "United Kingdom",
            "address": None,
        }

    # "KnownCity, Country" only — both sides must be clearly geographic
    for sep in (",", " - ", " – ", " — "):
        if sep not in text:
            continue
        left, right = [p.strip() for p in text.split(sep, 1)]
        if not left or not right:
            continue
        left_key = _norm_key(left)
        right_key = _norm_key(right)
        right_country = _strict_country_name(right)
        left_country = _strict_country_name(left)

        if right_country and left_key in _KNOWN_CITIES:
            return {
                "kind": "city_country",
                "city": left[:255],
                "country": right_country,
                "address": None,
            }
        if left_country and right_key in _KNOWN_CITIES:
            return {
                "kind": "city_country",
                "city": right[:255],
                "country": left_country,
                "address": None,
            }
        # Multi-word place + country (e.g. "Ras Al Khaimah, UAE")
        if (
            right_country
            and len(left.split()) >= 2
            and len(left) <= 40
            and not left.isupper()
            and not re.search(r"\d", left)
            and "house" not in left.lower()
            and "park" not in left.lower()
        ):
            return {
                "kind": "city_country",
                "city": left[:255],
                "country": right_country,
                "address": None,
            }

    return None


def _fetch_website_company_name(url: str) -> str | None:
    try:
        response = httpx.get(
            url if "://" in url else f"https://{url}",
            headers={
                "User-Agent": "KafiSalesAgent/1.0 (company-name-repair)",
                "Accept": "text/html,application/xhtml+xml",
            },
            follow_redirects=True,
            timeout=12,
        )
        response.raise_for_status()
        html = response.text[:400_000]
    except Exception:
        return None

    from modules.lead_discovery import _clean_company_name

    og = re.search(
        r'<meta[^>]+property=["\']og:site_name["\'][^>]+content=["\']([^"\']+)["\']',
        html,
        re.I,
    ) or re.search(
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+property=["\']og:site_name["\']',
        html,
        re.I,
    )
    if og:
        name = _clean_company_name(og.group(1))
        if _is_plausible_recovered_name(name):
            return name

    title_m = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    if title_m:
        name = _clean_company_name(re.sub(r"\s+", " ", title_m.group(1)))
        if _is_plausible_recovered_name(name):
            return name
    return None


def _recover_company_name(buyer: Buyer, contacts: list[Contact], *, bad_name: str) -> tuple[str | None, str]:
    """Try hard to recover a real company name. Returns (name_or_None, source)."""

    # 0) Brand embedded in the misplaced address label (e.g. Veetee House)
    for candidate in (bad_name, buyer.address):
        embedded = _name_from_building_label(candidate)
        if embedded:
            return embedded, "building_label"

    # 1) Website page title / og:site_name
    if buyer.website_url:
        name = _fetch_website_company_name(buyer.website_url)
        if _is_plausible_recovered_name(name, bad_location=bad_name):
            return name, "website_title"

    # 2) CompanyLens by domain
    domain = _domain_from_url(buyer.website_url)
    if domain:
        try:
            from modules.company_enrichment import enrich_domain_companylens

            lens = enrich_domain_companylens(domain)
            name = (lens.get("name") or "").strip() or None
            if _is_plausible_recovered_name(name, bad_location=bad_name):
                return name, "companylens"
        except Exception:
            pass
        brand = _brand_from_domain(domain)
        if _is_plausible_recovered_name(brand, bad_location=bad_name):
            # Prefer title over bare domain brand when possible; keep as fallback
            return brand, "website_domain"

    # 3) Contact business email domain
    for contact in contacts:
        for email in (contact.email, contact.secondary_email):
            if not email or "@" not in email:
                continue
            host = email.split("@", 1)[1].strip().lower()
            if host in _FREE_EMAIL_DOMAINS:
                continue
            try:
                from modules.company_enrichment import enrich_domain_companylens

                lens = enrich_domain_companylens(host)
                name = (lens.get("name") or "").strip() or None
                if _is_plausible_recovered_name(name, bad_location=bad_name):
                    return name, "email_domain_companylens"
            except Exception:
                pass
            brand = _brand_from_domain(host)
            if _is_plausible_recovered_name(brand, bad_location=bad_name):
                return brand, "email_domain"

    # 4) LinkedIn company slug
    linkedin = (buyer.linkedin_company_url or "").strip()
    if "linkedin.com/company/" in linkedin.lower():
        slug = linkedin.rstrip("/").split("/")[-1]
        slug = re.sub(r"[^a-zA-Z0-9\-]", "", slug)
        if slug and len(slug) >= 3:
            brand = " ".join(p.capitalize() for p in slug.split("-") if p)
            if _is_plausible_recovered_name(brand, bad_location=bad_name):
                return brand, "linkedin_slug"

    # 5) Phone / address web search → knowledge graph title (not searching the bad location alone)
    try:
        from modules import web_search

        phone = None
        for contact in contacts:
            phone = (contact.phone or contact.primary_phone or "").strip() or None
            if phone:
                break
        queries: list[str] = []
        if phone and len(re.sub(r"\D", "", phone)) >= 8:
            queries.append(f'"{phone}"')
        addr = (buyer.address or "").strip()
        if addr and len(addr) >= 12 and _STREET_HINT_RE.search(addr):
            queries.append(f'"{addr}"')
        if domain:
            queries.append(f"site:{domain}")

        for query in queries[:3]:
            if not web_search.any_combined_provider_available():
                break
            found = web_search.search_combined(query, num=5)
            kg = (found.knowledge_graph or {}) if found else {}
            title = (kg.get("title") or "").strip()
            if _is_plausible_recovered_name(title, bad_location=bad_name):
                return title[:120], "web_search_kg"
            for item in (found.organic or [])[:5]:
                from modules.lead_discovery import _clean_company_name

                title = _clean_company_name(item.get("title") or "")
                link = item.get("link") or ""
                item_domain = _domain_from_url(link)
                if domain and item_domain and item_domain != domain:
                    continue
                if _is_plausible_recovered_name(title, bad_location=bad_name):
                    return title[:120], "web_search_organic"
    except Exception as exc:
        logger.debug("web search name recovery failed: %s", exc)

    # 6) Wikidata using address/city clues + website domain brand already tried
    return None, "not_found"


def _apply_location_fields(
    buyer: Buyer,
    loc: dict[str, Any],
    updates: dict[str, Any],
) -> None:
    city = loc.get("city")
    country = loc.get("country")
    address = loc.get("address")

    if city and not _norm(buyer.city):
        updates["city"] = city
    elif city and _norm_key(buyer.city) == _norm_key(buyer.company_name):
        updates["city"] = city

    if country and not _norm(buyer.country):
        updates["country"] = country

    if address and not _norm(buyer.address):
        updates["address"] = address
    elif address and _norm_key(buyer.address or "") == _norm_key(buyer.company_name):
        updates["address"] = address

    # If company was a city and city already held something else that looks empty of value
    if loc.get("kind") == "city" and city:
        if not _norm(buyer.city) or _norm_key(buyer.city) == _norm_key(buyer.company_name):
            updates["city"] = city


def repair_buyer_location_company_name(
    db: Session,
    buyer_id: int,
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    buyer = buyers_module.get_buyer(db, buyer_id)
    if not buyer:
        return {"buyer_id": buyer_id, "status": "missing"}

    original = _norm(buyer.company_name)
    loc = classify_location_name(original)
    if loc is None:
        return {
            "buyer_id": buyer_id,
            "status": "skipped",
            "company_name": original,
            "reason": "company_name_does_not_look_like_location",
        }

    contacts = buyers_module.list_contacts_for_buyer(db, buyer_id)
    if dry_run:
        # Fast preview: classify + relocate only; skip live web recovery.
        recovered, source = None, "dry_run_skip_lookup"
        # Still try cheap local signals (domain brand / linkedin slug / email host brand)
        domain = _domain_from_url(buyer.website_url)
        brand = _brand_from_domain(domain)
        if _is_plausible_recovered_name(brand, bad_location=original):
            recovered, source = brand, "website_domain_preview"
        else:
            for contact in contacts:
                for email in (contact.email, contact.secondary_email):
                    if not email or "@" not in email:
                        continue
                    host = email.split("@", 1)[1].strip().lower()
                    if host in _FREE_EMAIL_DOMAINS:
                        continue
                    brand = _brand_from_domain(host)
                    if _is_plausible_recovered_name(brand, bad_location=original):
                        recovered, source = brand, "email_domain_preview"
                        break
                if recovered:
                    break
    else:
        recovered, source = _recover_company_name(buyer, contacts, bad_name=original)

    updates: dict[str, Any] = {}
    _apply_location_fields(buyer, loc, updates)

    new_name = recovered if recovered else ""
    updates["company_name"] = new_name

    note = f"[name-repair] moved company_name “{original}” → {loc.get('kind')}"
    if recovered:
        note += f"; recovered “{recovered}” via {source}"
    else:
        note += f"; company name not found ({source})"
    existing_remarks = _norm(buyer.remarks)
    if note not in existing_remarks:
        updates["remarks"] = f"{existing_remarks}\n{note}".strip() if existing_remarks else note

    result = {
        "buyer_id": buyer_id,
        "status": "repaired" if recovered else "relocated_name_empty",
        "old_company_name": original,
        "new_company_name": new_name or None,
        "location_kind": loc.get("kind"),
        "city": updates.get("city", buyer.city),
        "country": updates.get("country", buyer.country),
        "address": updates.get("address", buyer.address),
        "name_source": source,
        "dry_run": dry_run,
    }

    if dry_run:
        return result

    buyers_module.update_buyer(db, buyer_id, updates)
    return result


def repair_location_company_names(
    db: Session,
    *,
    source: str | None = "old_clients",
    exclude_source: str | None = None,
    assigned_to_user_id: int | None = None,
    unassigned_only: bool = False,
    dry_run: bool = False,
    limit: int | None = None,
    sleep_s: float = 0.15,
) -> dict[str, Any]:
    """Scan buyers and repair rows where company_name is a location."""
    from modules.leads import _apply_lead_table_scope

    query = _apply_lead_table_scope(
        db.query(Buyer),
        source=source,
        exclude_source=exclude_source,
        assigned_to_user_id=assigned_to_user_id,
        unassigned_only=unassigned_only,
    ).order_by(Buyer.id.asc())

    buyers = query.all()
    scanned = 0
    candidates = 0
    repaired = 0
    emptied = 0
    skipped = 0
    samples: list[dict[str, Any]] = []

    for buyer in buyers:
        scanned += 1
        if classify_location_name(buyer.company_name) is None:
            skipped += 1
            continue
        candidates += 1
        if limit is not None and (repaired + emptied) >= limit:
            # Count remaining candidates without repairing them
            continue
        row = repair_buyer_location_company_name(db, buyer.id, dry_run=dry_run)
        if row.get("status") == "repaired":
            repaired += 1
        elif row.get("status") == "relocated_name_empty":
            emptied += 1
        if len(samples) < 40:
            samples.append(row)
        if not dry_run and sleep_s > 0:
            time.sleep(sleep_s)

    return {
        "scanned": scanned,
        "location_name_candidates": candidates,
        "repaired_with_name": repaired,
        "relocated_name_empty": emptied,
        "skipped": skipped,
        "dry_run": dry_run,
        "samples": samples,
    }
