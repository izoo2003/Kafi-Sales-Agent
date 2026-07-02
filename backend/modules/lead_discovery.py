"""Lead discovery — find prospect companies from seed lead, web search, or CSV."""

from __future__ import annotations

import csv
import io
import re
import uuid
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from config import settings
from modules import buyers as buyers_module
from modules.product_catalog import load_catalog
from modules.research import ResearchModule
from modules.robots import USER_AGENT, can_fetch

_PARTNER_LINK_KEYWORDS = (
    "distributor",
    "partner",
    "retailer",
    "importer",
    "wholesale",
    "stockist",
    "dealer",
    "client",
    "customer",
    "supplier",
)
_SKIP_DOMAINS = (
    "facebook.com",
    "instagram.com",
    "twitter.com",
    "x.com",
    "linkedin.com",
    "youtube.com",
    "wikipedia.org",
    "google.com",
    "amazon.com",
    "ebay.com",
)
_SKIP_URL_PARTS = ("/login", "/signup", "/cart", "/privacy", "/terms", "/cookie")
_COMPANY_SUFFIXES = re.compile(
    r"\b(llc|l\.l\.c|ltd|limited|inc|corp|gmbh|pte|pvt|trading|foods|food|group|international)\b",
    re.I,
)


@dataclass
class DiscoveryCandidate:
    candidate_id: str
    company_name: str
    website_url: str | None = None
    country: str | None = None
    industry: str | None = None
    source: str = "manual"
    source_detail: str = ""
    match_reason: str = ""
    already_exists: bool = False

    def to_dict(self) -> dict[str, Any]:
        return {
            "candidate_id": self.candidate_id,
            "company_name": self.company_name,
            "website_url": self.website_url,
            "country": self.country,
            "industry": self.industry,
            "source": self.source,
            "source_detail": self.source_detail,
            "match_reason": self.match_reason,
            "already_exists": self.already_exists,
        }


@dataclass
class DiscoveryResult:
    candidates: list[DiscoveryCandidate] = field(default_factory=list)
    sources_used: list[str] = field(default_factory=list)
    messages: list[str] = field(default_factory=list)
    search_query: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "candidates": [c.to_dict() for c in self.candidates],
            "sources_used": self.sources_used,
            "messages": self.messages,
            "search_query": self.search_query,
        }


def _normalize_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _domain(url: str | None) -> str | None:
    if not url:
        return None
    try:
        parsed = urlparse(url if "://" in url else f"https://{url}")
        host = parsed.netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except ValueError:
        return None


def _existing_buyer_keys(db: Session) -> tuple[set[str], set[str]]:
    names: set[str] = set()
    domains: set[str] = set()
    for buyer in buyers_module.list_buyers(db):
        names.add(_normalize_name(buyer.company_name))
        domain = _domain(buyer.website_url)
        if domain:
            domains.add(domain)
    return names, domains


def _mark_existing(
    candidates: list[DiscoveryCandidate],
    existing_names: set[str],
    existing_domains: set[str],
) -> None:
    for candidate in candidates:
        name_key = _normalize_name(candidate.company_name)
        domain = _domain(candidate.website_url)
        if name_key in existing_names or (domain and domain in existing_domains):
            candidate.already_exists = True


def _dedupe_candidates(candidates: list[DiscoveryCandidate]) -> list[DiscoveryCandidate]:
    seen_names: set[str] = set()
    seen_domains: set[str] = set()
    unique: list[DiscoveryCandidate] = []
    for candidate in candidates:
        name_key = _normalize_name(candidate.company_name)
        domain = _domain(candidate.website_url)
        if name_key in seen_names:
            continue
        if domain and domain in seen_domains:
            continue
        seen_names.add(name_key)
        if domain:
            seen_domains.add(domain)
        unique.append(candidate)
    return unique


def _looks_like_company_name(text: str) -> bool:
    text = text.strip()
    if len(text) < 3 or len(text) > 120:
        return False
    if text.lower().startswith(("http", "www.", "click", "read more", "learn more")):
        return False
    if "@" in text:
        return False
    words = text.split()
    if len(words) >= 2 or _COMPANY_SUFFIXES.search(text):
        return True
    return text[0].isupper() and len(words) == 1 and len(text) >= 4


def _clean_company_name(title: str) -> str:
    name = re.split(r"[-|–—:]", title)[0].strip()
    name = re.sub(r"\s+(home|homepage|official site)$", "", name, flags=re.I)
    return name[:120]


def _category_search_terms(categories: list[str], limit: int = 4) -> list[str]:
    catalog = load_catalog()
    keywords_map = catalog.get("category_buyer_keywords", {})
    terms: list[str] = []
    for category in categories:
        for kw in keywords_map.get(category, []):
            if kw not in terms:
                terms.append(kw)
            if len(terms) >= limit:
                return terms
    return terms


def _build_search_query(
    country: str | None,
    industry: str | None,
    categories: list[str],
) -> str:
    parts: list[str] = ["food importer distributor wholesale"]
    if country:
        parts.append(country)
    if industry:
        parts.append(industry)
    parts.extend(_category_search_terms(categories))
    return " ".join(parts)


def _discover_via_serpapi(query: str, limit: int, country: str | None) -> list[DiscoveryCandidate]:
    api_key = settings.serpapi_api_key
    if not api_key:
        return []

    params: dict[str, str | int] = {
        "engine": "google",
        "q": query,
        "api_key": api_key,
        "num": min(limit * 2, 20),
    }
    if country:
        params["gl"] = country[:2].lower() if len(country) >= 2 else country

    try:
        response = httpx.get("https://serpapi.com/search.json", params=params, timeout=20)
        response.raise_for_status()
        data = response.json()
    except httpx.HTTPError:
        return []

    candidates: list[DiscoveryCandidate] = []
    for item in data.get("organic_results", []):
        link = item.get("link") or ""
        title = item.get("title") or ""
        snippet = item.get("snippet") or ""

        domain = _domain(link)
        if not domain or any(skip in domain for skip in _SKIP_DOMAINS):
            continue
        if any(part in link.lower() for part in _SKIP_URL_PARTS):
            continue

        company_name = _clean_company_name(title)
        if not _looks_like_company_name(company_name):
            continue

        candidates.append(
            DiscoveryCandidate(
                candidate_id=str(uuid.uuid4()),
                company_name=company_name,
                website_url=link,
                country=country,
                source="web_search",
                source_detail="SerpAPI Google search",
                match_reason=snippet[:200] if snippet else f"Matched query: {query}",
            )
        )
        if len(candidates) >= limit:
            break
    return candidates


def _discover_via_website_links(
    seed_url: str,
    country: str | None,
    industry: str | None,
    limit: int,
) -> list[DiscoveryCandidate]:
    if not can_fetch(seed_url):
        return []

    seed_domain = _domain(seed_url)
    candidates: list[DiscoveryCandidate] = []
    paths = ["", "/about", "/about-us", "/partners", "/distributors", "/clients", "/customers"]

    try:
        for path in paths:
            page_url = urljoin(seed_url.rstrip("/") + "/", path.lstrip("/"))
            if not can_fetch(page_url):
                continue
            try:
                response = httpx.get(
                    page_url,
                    timeout=15,
                    follow_redirects=True,
                    headers={"User-Agent": USER_AGENT},
                )
                response.raise_for_status()
            except httpx.HTTPError:
                continue

            soup = BeautifulSoup(response.text, "html.parser")
            for anchor in soup.find_all("a", href=True):
                href = anchor["href"].strip()
                if not href or href.startswith(("#", "mailto:", "tel:", "javascript:")):
                    continue

                full_url = urljoin(page_url, href)
                link_domain = _domain(full_url)
                if not link_domain or link_domain == seed_domain:
                    continue
                if any(skip in link_domain for skip in _SKIP_DOMAINS):
                    continue

                link_text = anchor.get_text(strip=True)
                context = f"{link_text} {anchor.get('title', '')}".lower()
                if not any(kw in context or kw in full_url.lower() for kw in _PARTNER_LINK_KEYWORDS):
                    if not _looks_like_company_name(link_text):
                        continue

                company_name = link_text if _looks_like_company_name(link_text) else link_domain.split(".")[0].title()
                if not _looks_like_company_name(company_name):
                    continue

                candidates.append(
                    DiscoveryCandidate(
                        candidate_id=str(uuid.uuid4()),
                        company_name=company_name[:120],
                        website_url=full_url if full_url.startswith("http") else f"https://{full_url}",
                        country=country,
                        industry=industry,
                        source="website_links",
                        source_detail=f"Linked from {seed_domain}",
                        match_reason=f"Partner/distributor link on seed website ({path or '/'})",
                    )
                )
                if len(candidates) >= limit:
                    return _dedupe_candidates(candidates)
    except httpx.HTTPError:
        return _dedupe_candidates(candidates)

    return _dedupe_candidates(candidates)


def _resolve_seed_context(
    db: Session,
    seed_lead_id: int | None,
    country: str | None,
    industry: str | None,
    categories: list[str],
) -> tuple[str | None, str | None, list[str], str | None]:
    website_url: str | None = None
    if seed_lead_id:
        buyer = buyers_module.get_buyer(db, seed_lead_id)
        if buyer:
            country = country or buyer.country
            industry = industry or buyer.industry
            website_url = buyer.website_url
            if not categories:
                profile = ResearchModule().research_buyer(db, seed_lead_id)
                categories = profile.matched_categories
    return country, industry, categories, website_url


def discover_leads(
    db: Session,
    *,
    seed_lead_id: int | None = None,
    country: str | None = None,
    industry: str | None = None,
    categories: list[str] | None = None,
    limit: int = 15,
    use_web_search: bool = True,
    use_website_links: bool = True,
) -> DiscoveryResult:
    categories = categories or []
    limit = max(1, min(limit, 30))
    result = DiscoveryResult()

    country, industry, categories, seed_url = _resolve_seed_context(
        db, seed_lead_id, country, industry, categories
    )

    if not country and not industry and not categories and not seed_url:
        result.messages.append(
            "Provide a seed lead, country, industry, or product categories to discover prospects."
        )
        return result

    all_candidates: list[DiscoveryCandidate] = []
    query = _build_search_query(country, industry, categories)
    result.search_query = query

    if use_web_search:
        if settings.serpapi_api_key:
            found = _discover_via_serpapi(query, limit, country)
            if found:
                result.sources_used.append("web_search")
                all_candidates.extend(found)
            else:
                result.messages.append("Web search returned no results for this query.")
        else:
            result.messages.append(
                "Set SERPAPI_API_KEY in backend/.env to enable web search discovery."
            )

    if use_website_links and seed_url:
        found = _discover_via_website_links(seed_url, country, industry, limit)
        if found:
            result.sources_used.append("website_links")
            all_candidates.extend(found)
        elif seed_url:
            result.messages.append("No partner/distributor links found on the seed website.")

    all_candidates = _dedupe_candidates(all_candidates)[:limit]
    existing_names, existing_domains = _existing_buyer_keys(db)
    _mark_existing(all_candidates, existing_names, existing_domains)
    result.candidates = all_candidates

    if not all_candidates and not result.messages:
        result.messages.append("No discovery candidates found. Try different filters or add SERPAPI_API_KEY.")
    return result


def parse_csv_candidates(content: str, default_country: str | None = None) -> list[DiscoveryCandidate]:
    """Parse CSV with flexible headers (company_name, website, country, industry)."""
    reader = csv.DictReader(io.StringIO(content))
    if not reader.fieldnames:
        return []

    def col(*names: str) -> str | None:
        for field in reader.fieldnames or []:
            normalized = field.strip().lower().replace(" ", "_")
            if normalized in names:
                return field
        return None

    name_col = col("company_name", "company", "name", "buyer", "organization")
    website_col = col("website_url", "website", "url", "web")
    country_col = col("country", "market", "region")
    industry_col = col("industry", "sector", "type", "business_type")

    if not name_col:
        raise ValueError("CSV must include a company name column (company_name, company, or name).")

    candidates: list[DiscoveryCandidate] = []
    for row in reader:
        name = (row.get(name_col) or "").strip()
        if not name:
            continue
        website = (row.get(website_col) or "").strip() if website_col else ""
        country = (row.get(country_col) or "").strip() if country_col else ""
        industry = (row.get(industry_col) or "").strip() if industry_col else ""
        candidates.append(
            DiscoveryCandidate(
                candidate_id=str(uuid.uuid4()),
                company_name=name,
                website_url=website or None,
                country=country or default_country,
                industry=industry or None,
                source="csv",
                source_detail="CSV import",
                match_reason="Imported from CSV",
            )
        )
    return candidates


def discover_from_csv(
    db: Session,
    content: str,
    default_country: str | None = None,
) -> DiscoveryResult:
    result = DiscoveryResult(sources_used=["csv"])
    try:
        candidates = parse_csv_candidates(content, default_country)
    except ValueError as exc:
        result.messages.append(str(exc))
        return result

    if not candidates:
        result.messages.append("No rows found in CSV.")
        return result

    existing_names, existing_domains = _existing_buyer_keys(db)
    _mark_existing(candidates, existing_names, existing_domains)
    result.candidates = candidates
    return result


def import_candidates(
    db: Session,
    candidates: list[dict[str, Any]],
    *,
    auto_onboard: bool = False,
) -> dict[str, Any]:
    from modules import leads as leads_module
    from modules.audit import log_action

    created: list[Any] = []
    skipped: list[dict[str, str]] = []
    onboard_results: list[dict[str, Any]] = []
    existing_names, existing_domains = _existing_buyer_keys(db)

    for raw in candidates:
        name = (raw.get("company_name") or "").strip()
        if not name:
            skipped.append({"company_name": name or "(empty)", "reason": "Missing company name"})
            continue

        name_key = _normalize_name(name)
        domain = _domain(raw.get("website_url"))
        if name_key in existing_names or (domain and domain in existing_domains):
            skipped.append({"company_name": name, "reason": "Already in leads"})
            continue

        buyer = buyers_module.create_buyer(
            db,
            {
                "company_name": name,
                "website_url": raw.get("website_url") or None,
                "country": raw.get("country") or None,
                "industry": raw.get("industry") or None,
                "source": raw.get("source") or "discovery",
            },
        )
        existing_names.add(name_key)
        if domain:
            existing_domains.add(domain)
        created.append(buyer)
        log_action(
            db,
            entity_type="buyer",
            entity_id=buyer.id,
            action="discovered_import",
            details={"source": raw.get("source")},
        )

        if auto_onboard:
            try:
                onboard = leads_module.onboard_buyer(db, buyer.id)
                onboard_results.append(
                    {
                        "buyer_id": buyer.id,
                        "company_name": buyer.company_name,
                        "score": onboard.get("score"),
                        "reasoning": onboard.get("reasoning"),
                    }
                )
            except ValueError as exc:
                onboard_results.append(
                    {
                        "buyer_id": buyer.id,
                        "company_name": buyer.company_name,
                        "error": str(exc),
                    }
                )

    return {
        "created_count": len(created),
        "skipped_count": len(skipped),
        "created": created,
        "skipped": skipped,
        "onboard_results": onboard_results,
    }
