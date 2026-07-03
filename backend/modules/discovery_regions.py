"""Canonical target markets for lead discovery."""

from __future__ import annotations

from typing import TypedDict


class DiscoveryRegion(TypedDict):
    code: str
    label: str
    group: str
    gl_code: str


MAX_DISCOVERY_REGIONS = 3

DISCOVERY_REGIONS: list[DiscoveryRegion] = [
    # North America
    {"code": "us", "label": "United States", "group": "North America", "gl_code": "us"},
    {"code": "ca", "label": "Canada", "group": "North America", "gl_code": "ca"},
    {"code": "mx", "label": "Mexico", "group": "North America", "gl_code": "mx"},
    # Europe
    {"code": "uk", "label": "United Kingdom", "group": "Europe", "gl_code": "gb"},
    {"code": "de", "label": "Germany", "group": "Europe", "gl_code": "de"},
    {"code": "fr", "label": "France", "group": "Europe", "gl_code": "fr"},
    {"code": "nl", "label": "Netherlands", "group": "Europe", "gl_code": "nl"},
    {"code": "it", "label": "Italy", "group": "Europe", "gl_code": "it"},
    {"code": "es", "label": "Spain", "group": "Europe", "gl_code": "es"},
    # Middle East
    {"code": "ae", "label": "UAE", "group": "Middle East", "gl_code": "ae"},
    {"code": "sa", "label": "Saudi Arabia", "group": "Middle East", "gl_code": "sa"},
    {"code": "qa", "label": "Qatar", "group": "Middle East", "gl_code": "qa"},
    {"code": "kw", "label": "Kuwait", "group": "Middle East", "gl_code": "kw"},
    {"code": "om", "label": "Oman", "group": "Middle East", "gl_code": "om"},
    {"code": "bh", "label": "Bahrain", "group": "Middle East", "gl_code": "bh"},
    # Africa
    {"code": "za", "label": "South Africa", "group": "Africa", "gl_code": "za"},
    {"code": "ke", "label": "Kenya", "group": "Africa", "gl_code": "ke"},
    {"code": "ng", "label": "Nigeria", "group": "Africa", "gl_code": "ng"},
    {"code": "eg", "label": "Egypt", "group": "Africa", "gl_code": "eg"},
    # Asia Pacific
    {"code": "au", "label": "Australia", "group": "Asia Pacific", "gl_code": "au"},
    {"code": "pk", "label": "Pakistan", "group": "Asia Pacific", "gl_code": "pk"},
    {"code": "in", "label": "India", "group": "Asia Pacific", "gl_code": "in"},
    {"code": "bd", "label": "Bangladesh", "group": "Asia Pacific", "gl_code": "bd"},
    {"code": "my", "label": "Malaysia", "group": "Asia Pacific", "gl_code": "my"},
    {"code": "sg", "label": "Singapore", "group": "Asia Pacific", "gl_code": "sg"},
    {"code": "id", "label": "Indonesia", "group": "Asia Pacific", "gl_code": "id"},
    {"code": "cn", "label": "China", "group": "Asia Pacific", "gl_code": "cn"},
    {"code": "jp", "label": "Japan", "group": "Asia Pacific", "gl_code": "jp"},
]

_REGION_BY_CODE = {region["code"]: region for region in DISCOVERY_REGIONS}
_REGION_BY_LABEL = {region["label"].lower(): region for region in DISCOVERY_REGIONS}


def list_discovery_regions() -> dict[str, object]:
    return {
        "max_regions": MAX_DISCOVERY_REGIONS,
        "regions": DISCOVERY_REGIONS,
    }


def resolve_region_codes(codes: list[str] | None) -> tuple[list[DiscoveryRegion], list[str]]:
    """Validate region codes; return resolved regions and any error messages."""
    if not codes:
        return [], []

    messages: list[str] = []
    if len(codes) > MAX_DISCOVERY_REGIONS:
        messages.append(f"Select at most {MAX_DISCOVERY_REGIONS} regions.")
        codes = codes[:MAX_DISCOVERY_REGIONS]

    resolved: list[DiscoveryRegion] = []
    seen: set[str] = set()
    for code in codes:
        normalized = code.strip().lower()
        if not normalized or normalized in seen:
            continue
        region = _REGION_BY_CODE.get(normalized)
        if not region:
            messages.append(f"Unknown region code: {code}")
            continue
        seen.add(normalized)
        resolved.append(region)

    return resolved, messages


def match_region_code(value: str | None) -> str | None:
    if not value:
        return None
    key = value.strip().lower()
    if key in _REGION_BY_CODE:
        return key
    if key in _REGION_BY_LABEL:
        return _REGION_BY_LABEL[key]["code"]
    for region in DISCOVERY_REGIONS:
        if key == region["label"].lower():
            return region["code"]
    # Avoid short-substring false positives (e.g. "au" inside unrelated text).
    if len(key) >= 4:
        matches = [
            region
            for region in DISCOVERY_REGIONS
            if key in region["label"].lower() or region["label"].lower() in key
        ]
        if matches:
            return max(matches, key=lambda region: len(region["label"]))["code"]
    return None
