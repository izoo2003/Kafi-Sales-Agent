from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from db.models import Buyer, Contact, LeadScore
from modules import buyers as buyers_module
from modules.countries import country_matches, list_countries
from modules.orchestrator import Orchestrator
from modules.research import BuyerProfile, ResearchModule

_orchestrator = Orchestrator()
_research = ResearchModule()

_SCORE_ORDER = {"HOT": 0, "WARM": 1, "COLD": 2}
_SORT_FIELDS = {
    "company_name",
    "country",
    "industry",
    "source",
    "latest_score",
    "market_role",
    "created_at",
    "scored_at",
}


def research_buyer(db: Session, buyer_id: int, *, force_refresh: bool = False) -> BuyerProfile:
    return _research.research_buyer(db, buyer_id, force_refresh=force_refresh)


def list_buyers_with_scores(db: Session) -> list[dict]:
    """Return all buyers enriched with their latest HOT/WARM/COLD score."""
    buyers = buyers_module.list_buyers(db)
    if not buyers:
        return []

    buyer_ids = [b.id for b in buyers]

    latest_sub = (
        db.query(
            LeadScore.buyer_id,
            sa_func.max(LeadScore.scored_at).label("max_scored_at"),
        )
        .filter(LeadScore.buyer_id.in_(buyer_ids))
        .group_by(LeadScore.buyer_id)
        .subquery()
    )
    score_rows = (
        db.query(LeadScore)
        .join(
            latest_sub,
            (LeadScore.buyer_id == latest_sub.c.buyer_id)
            & (LeadScore.scored_at == latest_sub.c.max_scored_at),
        )
        .all()
    )
    score_map = {s.buyer_id: s for s in score_rows}

    results: list[dict] = []
    for buyer in buyers:
        score = score_map.get(buyer.id)
        results.append(
            {
                "id": buyer.id,
                "company_name": buyer.company_name,
                "website_url": buyer.website_url,
                "country": buyer.country,
                "industry": buyer.industry,
                "source": buyer.source,
                "market_role": buyer.market_role.value if buyer.market_role else "unknown",
                "market_role_reasoning": buyer.market_role_reasoning,
                "market_role_confidence": (
                    float(buyer.market_role_confidence)
                    if buyer.market_role_confidence is not None
                    else None
                ),
                "producer_tier": buyer.producer_tier.value if buyer.producer_tier else None,
                "producer_conversion_pct": (
                    float(buyer.producer_conversion_pct)
                    if buyer.producer_conversion_pct is not None
                    else None
                ),
                "producer_tier_reasoning": buyer.producer_tier_reasoning,
                "created_at": buyer.created_at,
                "latest_score": score.score.value if score else None,
                "score_reasoning": score.reasoning if score else None,
            }
        )
    return results


def get_saved_buyer_profile(db: Session, buyer_id: int) -> BuyerProfile | None:
    return _research.get_saved_profile(db, buyer_id)


def profile_to_read_dict(profile: BuyerProfile) -> dict:
    return {
        "buyer_id": profile.buyer_id,
        "company_name": profile.company_name,
        "website_url": profile.website_url,
        "country": profile.country,
        "industry": profile.industry,
        "website_summary": profile.website_summary,
        "social_summary": profile.social_summary,
        "relationship_context": profile.relationship_context,
        "signals": profile.signals,
        "matched_categories": profile.matched_categories,
        "matched_products": profile.matched_products,
        "product_fit_score": profile.product_fit_score,
        "market_role": profile.market_role,
        "market_role_reasoning": profile.market_role_reasoning,
        "market_role_confidence": profile.market_role_confidence,
        "producer_tier": profile.producer_tier,
        "producer_conversion_pct": profile.producer_conversion_pct,
        "producer_tier_reasoning": profile.producer_tier_reasoning,
        "researched_at": profile.researched_at,
    }


def score_buyer(db: Session, buyer_id: int) -> LeadScore:
    profile = _research.research_buyer(db, buyer_id)
    return _orchestrator.scoring.score(db, profile)


def onboard_buyer(db: Session, buyer_id: int) -> dict:
    return _orchestrator.handle_new_buyer(db, buyer_id)


def get_latest_score(db: Session, buyer_id: int) -> LeadScore | None:
    return (
        db.query(LeadScore)
        .filter(LeadScore.buyer_id == buyer_id)
        .order_by(LeadScore.scored_at.desc())
        .first()
    )


def list_quotation_eligible_leads(db: Session) -> list[dict]:
    """HOT/WARM buyers with a real contact email (required for outreach)."""
    from db.models import LeadScoreLabel, MarketRole, ProducerTier
    from modules import buyers as buyers_module

    eligible: list[dict] = []
    for buyer in buyers_module.list_buyers(db):
        if buyer.market_role == MarketRole.producer:
            if buyer.producer_tier != ProducerTier.weak:
                continue
            if buyer.producer_conversion_pct is None or float(buyer.producer_conversion_pct) < 40:
                continue
        score = get_latest_score(db, buyer.id)
        if not score or score.score not in (LeadScoreLabel.HOT, LeadScoreLabel.WARM):
            continue

        contact = buyers_module.primary_contact_with_email(db, buyer.id)
        if not contact:
            continue

        eligible.append(
            {
                "id": buyer.id,
                "company_name": buyer.company_name,
                "country": buyer.country,
                "industry": buyer.industry,
                "website_url": buyer.website_url,
                "source": buyer.source,
                "created_at": buyer.created_at,
                "latest_score": score.score.value,
                "score_reasoning": score.reasoning,
                "contact_email": contact.email,
                "contact_name": contact.full_name,
            }
        )
    return eligible


def get_lead_table_filters(db: Session) -> dict[str, list[str]]:
    buyers = buyers_module.list_buyers(db)
    industries = sorted({b.industry.strip() for b in buyers if b.industry and b.industry.strip()})
    sources = sorted({b.source.strip() for b in buyers if b.source and b.source.strip()})
    return {
        "countries": [country["name"] for country in list_countries()],
        "industries": industries,
        "sources": sources,
        "scores": ["HOT", "WARM", "COLD", "Unscored"],
        "market_roles": ["consumer", "producer", "hybrid", "unknown"],
    }


def list_leads_table(
    db: Session,
    *,
    score: str | None = None,
    country: str | None = None,
    industry: str | None = None,
    source: str | None = None,
    market_role: str | None = None,
    q: str | None = None,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
) -> dict[str, object]:
    buyers = db.query(Buyer).order_by(Buyer.created_at.desc()).all()
    buyer_ids = [buyer.id for buyer in buyers]

    score_by_buyer: dict[int, LeadScore] = {}
    if buyer_ids:
        all_scores = (
            db.query(LeadScore)
            .filter(LeadScore.buyer_id.in_(buyer_ids))
            .order_by(LeadScore.buyer_id.asc(), LeadScore.scored_at.desc())
            .all()
        )
        for record in all_scores:
            if record.buyer_id not in score_by_buyer:
                score_by_buyer[record.buyer_id] = record

    contact_by_buyer: dict[int, Contact] = {}
    if buyer_ids:
        all_contacts = (
            db.query(Contact)
            .filter(Contact.buyer_id.in_(buyer_ids))
            .order_by(Contact.buyer_id.asc(), Contact.id.asc())
            .all()
        )
        for contact in all_contacts:
            if contact.buyer_id not in contact_by_buyer:
                contact_by_buyer[contact.buyer_id] = contact
            if contact.email and (
                contact_by_buyer[contact.buyer_id].email is None
            ):
                contact_by_buyer[contact.buyer_id] = contact

    rows: list[dict[str, object]] = []
    for buyer in buyers:
        latest = score_by_buyer.get(buyer.id)
        latest_score = latest.score.value if latest else None
        contact = contact_by_buyer.get(buyer.id)
        rows.append(
            {
                "id": buyer.id,
                "company_name": buyer.company_name,
                "country": buyer.country,
                "industry": buyer.industry,
                "website_url": buyer.website_url,
                "linkedin_company_url": buyer.linkedin_company_url,
                "facebook_company_url": buyer.facebook_company_url,
                "instagram_company_url": buyer.instagram_company_url,
                "source": buyer.source,
                "created_at": buyer.created_at,
                "latest_score": latest_score,
                "score_reasoning": latest.reasoning if latest else None,
                "scored_at": latest.scored_at if latest else None,
                "contact_id": contact.id if contact else None,
                "contact_name": contact.full_name if contact else None,
                "contact_email": contact.email if contact else None,
                "contact_phone": contact.phone if contact else None,
                "market_role": buyer.market_role.value if buyer.market_role else "unknown",
                "market_role_reasoning": buyer.market_role_reasoning,
                "producer_tier": buyer.producer_tier.value if buyer.producer_tier else None,
                "producer_conversion_pct": (
                    float(buyer.producer_conversion_pct)
                    if buyer.producer_conversion_pct is not None
                    else None
                ),
                "producer_tier_reasoning": buyer.producer_tier_reasoning,
            }
        )

    query = (q or "").strip().lower()
    if query:
        rows = [
            row
            for row in rows
            if query in (row["company_name"] or "").lower()
            or query in (row["country"] or "").lower()
            or query in (row["industry"] or "").lower()
            or query in (row["contact_email"] or "").lower()
            or query in (row["contact_name"] or "").lower()
            or query in (row["market_role"] or "").lower()
            or query in (row["market_role_reasoning"] or "").lower()
        ]

    if score:
        if score == "Unscored":
            rows = [row for row in rows if not row["latest_score"]]
        else:
            rows = [row for row in rows if row["latest_score"] == score]

    if country:
        rows = [row for row in rows if country_matches(str(row["country"] or ""), country)]

    if industry:
        rows = [row for row in rows if (row["industry"] or "").lower() == industry.lower()]

    if source:
        rows = [row for row in rows if (row["source"] or "").lower() == source.lower()]

    if market_role:
        rows = [row for row in rows if (row["market_role"] or "unknown") == market_role]

    sort_field = sort_by if sort_by in _SORT_FIELDS else "created_at"
    reverse = sort_dir.lower() != "asc"

    def sort_key(row: dict[str, object]) -> tuple:
        value = row.get(sort_field)
        if sort_field == "latest_score":
            if not value:
                return (1, 99, "")
            return (0, _SCORE_ORDER.get(str(value), 99), str(value))
        if value is None:
            return (1, "")
        return (0, value)

    rows.sort(key=sort_key, reverse=reverse)

    return {
        "total": len(buyers),
        "filtered_count": len(rows),
        "rows": rows,
    }


def get_lead_table_row(db: Session, buyer_id: int) -> dict[str, object] | None:
    buyer = buyers_module.get_buyer(db, buyer_id)
    if not buyer:
        return None

    latest = get_latest_score(db, buyer_id)
    contacts = buyers_module.list_contacts_for_buyer(db, buyer_id)
    contact = next((c for c in contacts if c.email), contacts[0] if contacts else None)

    return {
        "id": buyer.id,
        "company_name": buyer.company_name,
        "country": buyer.country,
        "industry": buyer.industry,
        "website_url": buyer.website_url,
        "linkedin_company_url": buyer.linkedin_company_url,
        "facebook_company_url": buyer.facebook_company_url,
        "instagram_company_url": buyer.instagram_company_url,
        "source": buyer.source,
        "created_at": buyer.created_at,
        "latest_score": latest.score.value if latest else None,
        "score_reasoning": latest.reasoning if latest else None,
        "scored_at": latest.scored_at if latest else None,
        "contact_id": contact.id if contact else None,
        "contact_name": contact.full_name if contact else None,
        "contact_email": contact.email if contact else None,
        "contact_phone": contact.phone if contact else None,
        "market_role": buyer.market_role.value if buyer.market_role else "unknown",
        "market_role_reasoning": buyer.market_role_reasoning,
        "producer_tier": buyer.producer_tier.value if buyer.producer_tier else None,
        "producer_conversion_pct": (
            float(buyer.producer_conversion_pct)
            if buyer.producer_conversion_pct is not None
            else None
        ),
        "producer_tier_reasoning": buyer.producer_tier_reasoning,
    }


def update_lead_table_row(db: Session, buyer_id: int, data: dict) -> dict[str, object] | None:
    from modules.audit import log_action

    buyer_fields = {
        key: data[key]
        for key in (
            "company_name",
            "country",
            "industry",
            "website_url",
            "linkedin_company_url",
            "facebook_company_url",
            "instagram_company_url",
        )
        if key in data
    }
    if buyer_fields:
        if not buyers_module.update_buyer(db, buyer_id, buyer_fields):
            return None

    contact_fields_present = any(key in data for key in ("contact_name", "contact_email", "contact_phone"))
    if contact_fields_present:
        buyers_module.upsert_primary_contact(
            db,
            buyer_id,
            contact_id=data.get("contact_id"),
            full_name=data.get("contact_name"),
            email=data.get("contact_email"),
            phone=data.get("contact_phone"),
        )

    row = get_lead_table_row(db, buyer_id)
    if row:
        log_action(
            db,
            entity_type="buyer",
            entity_id=buyer_id,
            action="table_row_updated",
            details={key: data.get(key) for key in data if data.get(key) is not None},
        )
    return row


def dedupe_leads_table(db: Session) -> dict[str, object]:
    """Remove duplicate leads, keeping the richest record in each cluster."""
    from collections import defaultdict

    from modules.audit import log_action
    from modules.lead_discovery import _domain, _normalize_name

    buyers = buyers_module.list_buyers(db)
    if len(buyers) < 2:
        return {"removed_count": 0, "kept_count": len(buyers), "groups": []}

    parent = {buyer.id: buyer.id for buyer in buyers}

    def find_root(buyer_id: int) -> int:
        while parent[buyer_id] != buyer_id:
            parent[buyer_id] = parent[parent[buyer_id]]
            buyer_id = parent[buyer_id]
        return buyer_id

    def union(a_id: int, b_id: int) -> None:
        root_a = find_root(a_id)
        root_b = find_root(b_id)
        if root_a != root_b:
            parent[root_b] = root_a

    by_name: dict[str, list[int]] = defaultdict(list)
    by_domain: dict[str, list[int]] = defaultdict(list)
    for buyer in buyers:
        by_name[_normalize_name(buyer.company_name)].append(buyer.id)
        domain = _domain(buyer.website_url)
        if domain:
            by_domain[domain].append(buyer.id)

    for ids in by_name.values():
        for other_id in ids[1:]:
            union(ids[0], other_id)
    for ids in by_domain.values():
        for other_id in ids[1:]:
            union(ids[0], other_id)

    clusters: dict[int, list[Buyer]] = defaultdict(list)
    for buyer in buyers:
        clusters[find_root(buyer.id)].append(buyer)

    removed_count = 0
    groups: list[dict[str, object]] = []

    for cluster in clusters.values():
        if len(cluster) < 2:
            continue

        keeper = max(
            cluster,
            key=lambda buyer: (
                buyers_module.buyer_data_score(db, buyer),
                buyer.created_at.timestamp() if buyer.created_at else 0,
            ),
        )
        removed = [buyer for buyer in cluster if buyer.id != keeper.id]
        for buyer in removed:
            if delete_lead_table_row(db, buyer.id):
                removed_count += 1

        groups.append(
            {
                "company_name": keeper.company_name,
                "kept_id": keeper.id,
                "removed_ids": [buyer.id for buyer in removed],
                "removed_names": [buyer.company_name for buyer in removed],
            }
        )

    log_action(
        db,
        entity_type="buyer",
        entity_id=0,
        action="table_deduped",
        details={"removed_count": removed_count, "groups": len(groups)},
    )

    return {
        "removed_count": removed_count,
        "kept_count": len(buyers) - removed_count,
        "groups": groups,
    }


def cleanup_sparse_csv_leads(db: Session) -> dict[str, object]:
    """Remove CSV-imported leads that have almost no scraped details."""
    from modules.audit import log_action

    removed: list[dict[str, object]] = []
    for buyer in buyers_module.list_buyers(db):
        if (buyer.source or "").lower() != "csv":
            continue
        if not buyers_module.is_sparse_buyer(db, buyer):
            continue
        company_name = buyer.company_name
        buyer_id = buyer.id
        if delete_lead_table_row(db, buyer_id):
            removed.append({"id": buyer_id, "company_name": company_name})

    log_action(
        db,
        entity_type="buyer",
        entity_id=0,
        action="sparse_csv_cleanup",
        details={"removed_count": len(removed)},
    )

    return {
        "removed_count": len(removed),
        "removed": removed,
    }


def delete_lead_table_row(db: Session, buyer_id: int) -> bool:
    from modules.audit import log_action

    buyer = buyers_module.get_buyer(db, buyer_id)
    if not buyer:
        return False

    company_name = buyer.company_name
    if not buyers_module.delete_buyer(db, buyer_id):
        return False

    log_action(
        db,
        entity_type="buyer",
        entity_id=buyer_id,
        action="deleted",
        details={"company_name": company_name},
    )
    return True
