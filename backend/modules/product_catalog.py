"""Kafi ESSENCE product catalog — loaded from data/kafi_essence_catalog.json."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "kafi_essence_catalog.json"


@dataclass
class ProductFitResult:
    matched_categories: list[str] = field(default_factory=list)
    matched_products: list[dict] = field(default_factory=list)
    match_score: int = 0
    signals: list[str] = field(default_factory=list)


@lru_cache(maxsize=1)
def load_catalog() -> dict:
    if not CATALOG_PATH.exists():
        return {"products": [], "categories": {}, "category_buyer_keywords": {}}
    return json.loads(CATALOG_PATH.read_text(encoding="utf-8"))


def list_categories() -> dict[str, int]:
    return load_catalog().get("categories", {})


def list_products(category: str | None = None) -> list[dict]:
    products = load_catalog().get("products", [])
    if category:
        return [p for p in products if p.get("category") == category]
    return products


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text.lower()).strip()


def normalize_product_name(name: str) -> str:
    """Collapse whitespace/case for exact-name deduplication."""
    return re.sub(r"\s+", " ", name.strip()).lower()


_SIZE_SUFFIX_PATTERNS = [
    re.compile(r"\s+\d+\s*to\s*\d+\s*mm\b.*$", re.I),
    re.compile(r'\s+\d+"\s*length\b.*$', re.I),
    re.compile(r"\s+\d+[\d.]*\s*(?:g|kg|gm|gms|ml|l|ltr|oz)\b.*$", re.I),
    re.compile(r"\s+(?:pet|glass)\s+(?:bottle|jar|pack)\b.*$", re.I),
    re.compile(r"\s+packed in master carton.*$", re.I),
    re.compile(r"\s+\d+\s*x\s*\d+.*$", re.I),
]


def product_type_key(name: str) -> str:
    """Normalize SKU name to a product type (strip sizes/packaging)."""
    n = re.sub(r"\s*-\s*essence\s*$", "", name.strip(), flags=re.I)
    for pattern in _SIZE_SUFFIX_PATTERNS:
        n = pattern.sub("", n)
    return re.sub(r"\s+", " ", n).strip().lower()


def product_dedupe_key(name: str) -> str:
    """One key per distinct product — type first, then exact normalized name."""
    type_key = product_type_key(name)
    if type_key:
        return f"type:{type_key}"
    normalized = normalize_product_name(name)
    return f"name:{normalized}" if normalized else ""


def _display_name_for_type(type_key: str, variant_names: list[str]) -> str:
    unique_upper = {v.strip().upper() for v in variant_names}
    if len(unique_upper) == 1:
        return variant_names[0].strip()
    words = type_key.split()
    return " ".join(w.capitalize() if w.isascii() else w for w in words)


def list_unique_product_types() -> list[dict[str, str]]:
    """One entry per product type — no duplicate sizes/packaging SKUs."""
    catalog = load_catalog()
    buckets: dict[str, dict[str, object]] = {}

    for product in catalog.get("products", []):
        name = product["name"]
        key = product_type_key(name)
        if not key:
            continue
        if key not in buckets:
            buckets[key] = {"category": product.get("category", "other"), "variants": [name]}
        else:
            variants = buckets[key]["variants"]
            assert isinstance(variants, list)
            variants.append(name)

    result: list[dict[str, str]] = []
    for key, data in buckets.items():
        variants = data["variants"]
        assert isinstance(variants, list)
        result.append(
            {
                "type_key": key,
                "name": _display_name_for_type(key, variants),
                "category": str(data["category"]),
            }
        )

    return sorted(result, key=lambda x: (x["category"], x["name"].lower()))


def match_text_to_catalog(text: str, *, limit: int = 15) -> ProductFitResult:
    """Match website/social/history text against Kafi product keywords."""
    if not text:
        return ProductFitResult()

    catalog = load_catalog()
    type_variants: dict[str, list[str]] = {}
    for p in catalog.get("products", []):
        tk = product_type_key(p["name"])
        type_variants.setdefault(tk, []).append(p["name"])

    normalized = _normalize_text(text)
    category_hits: dict[str, int] = {}
    product_hits: list[tuple[int, dict, str]] = []

    for product in catalog.get("products", []):
        best_kw = None
        best_len = 0
        for kw in product.get("match_keywords", []):
            kw_l = kw.lower()
            if len(kw_l) >= 3 and kw_l in normalized and len(kw_l) > best_len:
                best_kw = kw
                best_len = len(kw_l)
        if best_kw:
            cat = product["category"]
            category_hits[cat] = category_hits.get(cat, 0) + 1
            product_hits.append((best_len, product, best_kw))

    for cat, keywords in catalog.get("category_buyer_keywords", {}).items():
        for kw in keywords:
            kw_l = kw.lower()
            if len(kw_l) >= 4 and kw_l in normalized:
                category_hits[cat] = category_hits.get(cat, 0) + 1

    product_hits.sort(key=lambda x: x[0], reverse=True)
    matched_products = []
    seen_type_keys: set[str] = set()
    for _, product, kw in product_hits:
        type_key = product_type_key(product["name"])
        if type_key in seen_type_keys:
            continue
        seen_type_keys.add(type_key)
        matched_products.append(
            {
                "name": _display_name_for_type(type_key, type_variants.get(type_key, [product["name"]])),
                "category": product["category"],
                "matched_keyword": kw,
                "type_key": type_key,
            }
        )
        if len(matched_products) >= limit:
            break

    matched_categories = sorted(category_hits.keys(), key=lambda c: category_hits[c], reverse=True)
    signals = [
        f"Product fit: {cat} ({category_hits[cat]} keyword hits)"
        for cat in matched_categories[:5]
    ]

    score = min(sum(category_hits.values()) * 5, 50)

    return ProductFitResult(
        matched_categories=matched_categories,
        matched_products=matched_products,
        match_score=score,
        signals=signals,
    )


def cross_sell_for_categories(
    purchased_categories: list[str],
    *,
    limit: int = 5,
) -> list[dict]:
    """Suggest categories/products buyer has not bought yet."""
    catalog = load_catalog()
    all_cats = set(catalog.get("categories", {}))
    purchased = set(purchased_categories)
    missing = all_cats - purchased - {"other"}
    recommendations = []
    for cat in sorted(missing):
        products = list_products(cat)
        if not products:
            continue
        sample = products[0]
        recommendations.append(
            {
                "category": cat,
                "product_name": sample["name"],
                "rationale": f"Buyer has not purchased {cat.replace('_', ' ')} — Kafi ESSENCE line available.",
            }
        )
        if len(recommendations) >= limit:
            break
    return recommendations
