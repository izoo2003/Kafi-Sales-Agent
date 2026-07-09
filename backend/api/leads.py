from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pathlib import Path
from sqlalchemy.orm import Session

from api.deps import get_db
from api.schemas import (
    BuyerCreate,
    BuyerProfileRead,
    BuyerRead,
    ContactCreate,
    ContactRead,
    ContactUpdate,
    DiscoverImportRequest,
    DiscoverImportResponse,
    DiscoverLeadsRequest,
    DiscoverLeadsResponse,
    DiscoveryCandidateRead,
    DiscoveryRegionsResponse,
    InteractionRead,
    LeadScoreRead,
    LeadTableCleanupResponse,
    LeadTableDedupeResponse,
    LeadTableFiltersRead,
    LeadTableResponse,
    LeadTableRowRead,
    LeadTableRowUpdate,
    ProductInterestEmailRequest,
    QuotationEligibleLeadRead,
)
from db.models import LeadScoreLabel
from modules.comms_generator import get_comms
from modules import buyers as buyers_module
from modules import leads as leads_module
from modules.audit import log_action
from modules.lead_discovery import discover_from_csv, discover_leads, import_candidates
from modules.file_to_csv import SUPPORTED_UPLOAD_EXTENSIONS, convert_upload_to_csv
from modules.discovery_regions import list_discovery_regions

router = APIRouter(prefix="/leads", tags=["leads"])


@router.get("", response_model=list[BuyerRead])
def list_leads(db: Session = Depends(get_db)):
    return leads_module.list_buyers_with_scores(db)


@router.post("", response_model=BuyerRead, status_code=201)
def create_lead(payload: BuyerCreate, db: Session = Depends(get_db)):
    buyer = buyers_module.create_buyer(db, payload.model_dump())
    log_action(db, entity_type="buyer", entity_id=buyer.id, action="created")
    return buyer


@router.post("/contacts", response_model=ContactRead, status_code=201)
def create_contact(payload: ContactCreate, db: Session = Depends(get_db)):
    if not buyers_module.get_buyer(db, payload.buyer_id):
        raise HTTPException(404, "Lead not found")
    contact = buyers_module.create_contact(db, payload.model_dump())
    log_action(
        db,
        entity_type="contact",
        entity_id=contact.id,
        action="created",
        details={"buyer_id": contact.buyer_id},
    )
    return contact


@router.patch("/contacts/{contact_id}", response_model=ContactRead)
def update_contact(
    contact_id: int,
    payload: ContactUpdate,
    db: Session = Depends(get_db),
):
    existing = buyers_module.get_contact(db, contact_id)
    if not existing:
        raise HTTPException(404, "Contact not found")
    contact = buyers_module.update_contact(
        db, contact_id, payload.model_dump(exclude_unset=True)
    )
    if not contact:
        raise HTTPException(404, "Contact not found")
    log_action(
        db,
        entity_type="contact",
        entity_id=contact.id,
        action="updated",
        details={"buyer_id": contact.buyer_id},
    )
    return contact


@router.delete("/contacts/{contact_id}", status_code=204)
def delete_contact(contact_id: int, db: Session = Depends(get_db)):
    contact = buyers_module.get_contact(db, contact_id)
    if not contact:
        raise HTTPException(404, "Contact not found")
    buyer_id = contact.buyer_id
    if not buyers_module.delete_contact(db, contact_id):
        raise HTTPException(404, "Contact not found")
    log_action(
        db,
        entity_type="contact",
        entity_id=contact_id,
        action="deleted",
        details={"buyer_id": buyer_id},
    )


@router.get("/{lead_id}/contacts", response_model=list[ContactRead])
def list_lead_contacts(lead_id: int, db: Session = Depends(get_db)):
    if not buyers_module.get_buyer(db, lead_id):
        raise HTTPException(404, "Lead not found")
    return buyers_module.list_contacts_for_buyer(db, lead_id)


@router.post("/{lead_id}/product-interest-email", response_model=InteractionRead)
def create_product_interest_email(
    lead_id: int,
    payload: ProductInterestEmailRequest,
    db: Session = Depends(get_db),
):
    buyer = buyers_module.get_buyer(db, lead_id)
    if not buyer:
        raise HTTPException(404, "Lead not found")

    score = leads_module.get_latest_score(db, lead_id)
    if not score:
        raise HTTPException(400, "Lead must be scored before drafting outreach")
    if score.score not in (LeadScoreLabel.HOT, LeadScoreLabel.WARM):
        raise HTTPException(400, "Product interest emails are for HOT or WARM leads only")

    from db.models import MarketRole, ProducerTier

    if buyer.market_role == MarketRole.producer:
        if buyer.producer_tier != ProducerTier.weak or (
            buyer.producer_conversion_pct is None or float(buyer.producer_conversion_pct) < 40
        ):
            raise HTTPException(
                400,
                "Strong producers are competitors. Weak producers need ≥40% conversion potential for outreach.",
            )

    contacts = buyers_module.list_contacts_for_buyer(db, lead_id)
    if not contacts:
        raise HTTPException(400, "Add a contact with an email address first")

    contact = None
    if payload.contact_id:
        contact = next((c for c in contacts if c.id == payload.contact_id), None)
        if not contact:
            raise HTTPException(400, "Contact not found for this lead")
    else:
        contact = next((c for c in contacts if c.email), contacts[0])

    if not contact.email:
        raise HTTPException(400, "Contact has no email address")

    products = [p.model_dump() for p in payload.products]
    try:
        draft = get_comms().generate_product_interest_email(
            db,
            contact_id=contact.id,
            products=products,
            attachments=[a.model_dump() for a in payload.attachments],
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    log_action(
        db,
        entity_type="interaction",
        entity_id=draft.id,
        action="product_interest_draft_created",
        details={"buyer_id": lead_id, "product_count": len(products)},
    )
    return draft


@router.get("/quotation-eligible", response_model=list[QuotationEligibleLeadRead])
def list_quotation_eligible_leads(db: Session = Depends(get_db)):
    return leads_module.list_quotation_eligible_leads(db)


@router.get("/product-types")
def list_product_types():
    from modules.product_catalog import list_unique_product_types

    types = list_unique_product_types()
    return {"count": len(types), "product_types": types}


@router.get("/table/filters", response_model=LeadTableFiltersRead)
def get_leads_table_filters(db: Session = Depends(get_db)):
    return LeadTableFiltersRead(**leads_module.get_lead_table_filters(db))


@router.get("/table", response_model=LeadTableResponse)
def list_leads_table(
    score: str | None = None,
    country: str | None = None,
    industry: str | None = None,
    source: str | None = None,
    market_role: str | None = None,
    q: str | None = None,
    sort_by: str = "created_at",
    sort_dir: str = "desc",
    db: Session = Depends(get_db),
):
    result = leads_module.list_leads_table(
        db,
        score=score,
        country=country,
        industry=industry,
        source=source,
        market_role=market_role,
        q=q,
        sort_by=sort_by,
        sort_dir=sort_dir,
    )
    return LeadTableResponse(**result)


@router.patch("/table/{lead_id}", response_model=LeadTableRowRead)
def update_lead_table_row(
    lead_id: int,
    payload: LeadTableRowUpdate,
    db: Session = Depends(get_db),
):
    row = leads_module.update_lead_table_row(
        db,
        lead_id,
        payload.model_dump(exclude_unset=True),
    )
    if not row:
        raise HTTPException(404, "Lead not found")
    return LeadTableRowRead(**row)


@router.delete("/table/{lead_id}", status_code=204)
def delete_lead_table_row(lead_id: int, db: Session = Depends(get_db)):
    if not leads_module.delete_lead_table_row(db, lead_id):
        raise HTTPException(404, "Lead not found")


@router.post("/table/dedupe", response_model=LeadTableDedupeResponse)
def dedupe_leads_table(db: Session = Depends(get_db)):
    result = leads_module.dedupe_leads_table(db)
    return LeadTableDedupeResponse(**result)


@router.post("/table/cleanup-sparse", response_model=LeadTableCleanupResponse)
def cleanup_sparse_csv_leads(db: Session = Depends(get_db)):
    result = leads_module.cleanup_sparse_csv_leads(db)
    return LeadTableCleanupResponse(**result)


@router.get("/discover/regions", response_model=DiscoveryRegionsResponse)
def get_discovery_regions():
    data = list_discovery_regions()
    return DiscoveryRegionsResponse(**data)


@router.post("/discover", response_model=DiscoverLeadsResponse)
def discover_similar_leads(payload: DiscoverLeadsRequest, db: Session = Depends(get_db)):
    result = discover_leads(
        db,
        seed_lead_id=payload.seed_lead_id,
        region_codes=payload.region_codes,
        country=payload.country,
        industry=payload.industry,
        industries=payload.industries,
        categories=payload.categories,
        limit=payload.limit,
        use_web_search=payload.use_web_search,
        use_website_links=payload.use_website_links,
    )
    return DiscoverLeadsResponse(
        candidates=[DiscoveryCandidateRead(**c.to_dict()) for c in result.candidates],
        sources_used=result.sources_used,
        messages=result.messages,
        search_query=result.search_query,
    )


@router.post("/discover/csv", response_model=DiscoverLeadsResponse)
async def discover_leads_from_csv(
    file: UploadFile = File(...),
    default_country: str | None = None,
    for_leads_table: bool = False,
    db: Session = Depends(get_db),
):
    raw = await file.read()
    if not raw:
        raise HTTPException(400, "The uploaded file is empty.")
    ext = Path((file.filename or "").strip()).suffix.lower()
    if ext and ext not in SUPPORTED_UPLOAD_EXTENSIONS:
        supported = ", ".join(sorted(SUPPORTED_UPLOAD_EXTENSIONS))
        raise HTTPException(400, f"Upload a supported file ({supported})")
    try:
        content, convert_messages = convert_upload_to_csv(file.filename, raw)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    result = discover_from_csv(
        db,
        content,
        default_country=default_country,
        for_leads_table=for_leads_table,
    )
    result.messages = convert_messages + result.messages
    if not result.candidates:
        detail = (
            "; ".join(result.messages)
            if result.messages
            else "No importable rows found in this file."
        )
        raise HTTPException(400, detail)
    return DiscoverLeadsResponse(
        candidates=[DiscoveryCandidateRead(**c.to_dict()) for c in result.candidates],
        sources_used=result.sources_used,
        messages=result.messages,
        search_query=result.search_query,
    )


@router.post("/discover/import", response_model=DiscoverImportResponse)
def import_discovered_leads(
    payload: DiscoverImportRequest,
    db: Session = Depends(get_db),
):
    result = import_candidates(
        db,
        [c.model_dump() for c in payload.candidates],
        auto_onboard=payload.auto_onboard,
        replace_duplicates=payload.replace_duplicates,
    )
    return DiscoverImportResponse(
        created_count=result["created_count"],
        skipped_count=result["skipped_count"],
        replaced_count=result.get("replaced_count", 0),
        created=result["created"],
        skipped=result["skipped"],
        replaced=result.get("replaced", []),
        onboard_results=result["onboard_results"],
    )


@router.get("/{lead_id}/cross-sell")
def cross_sell_recommendations(lead_id: int, db: Session = Depends(get_db)):
    from modules.commerce import get_commerce

    if not buyers_module.get_buyer(db, lead_id):
        raise HTTPException(404, "Lead not found")
    return get_commerce().recommend_cross_sell_from_catalog(db, lead_id)


@router.get("/{lead_id}", response_model=BuyerRead)
def get_lead(lead_id: int, db: Session = Depends(get_db)):
    buyer = buyers_module.get_buyer(db, lead_id)
    if not buyer:
        raise HTTPException(404, "Lead not found")
    return buyer


@router.post("/{lead_id}/research", response_model=BuyerProfileRead)
def research_lead(
    lead_id: int,
    force: bool = False,
    db: Session = Depends(get_db),
):
    if not buyers_module.get_buyer(db, lead_id):
        raise HTTPException(404, "Lead not found")
    try:
        profile = leads_module.research_buyer(db, lead_id, force_refresh=force)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    log_action(
        db,
        entity_type="buyer",
        entity_id=lead_id,
        action="research_completed",
        details={"researched_at": profile.researched_at.isoformat() if profile.researched_at else None},
    )
    return BuyerProfileRead(**leads_module.profile_to_read_dict(profile))


@router.get("/{lead_id}/profile", response_model=BuyerProfileRead)
def get_lead_profile(lead_id: int, db: Session = Depends(get_db)):
    if not buyers_module.get_buyer(db, lead_id):
        raise HTTPException(404, "Lead not found")
    try:
        profile = leads_module.get_saved_buyer_profile(db, lead_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    if not profile:
        raise HTTPException(404, "No research profile on record for this lead")
    return BuyerProfileRead(**leads_module.profile_to_read_dict(profile))


@router.get("/{lead_id}/score", response_model=LeadScoreRead)
def get_latest_lead_score(lead_id: int, db: Session = Depends(get_db)):
    if not buyers_module.get_buyer(db, lead_id):
        raise HTTPException(404, "Lead not found")
    score = leads_module.get_latest_score(db, lead_id)
    if not score:
        raise HTTPException(404, "No score on record for this lead")
    return score


@router.post("/{lead_id}/score", response_model=LeadScoreRead)
def score_lead(lead_id: int, db: Session = Depends(get_db)):
    if not buyers_module.get_buyer(db, lead_id):
        raise HTTPException(404, "Lead not found")
    try:
        return leads_module.score_buyer(db, lead_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/{lead_id}/onboard")
def onboard_lead(lead_id: int, db: Session = Depends(get_db)):
    if not buyers_module.get_buyer(db, lead_id):
        raise HTTPException(404, "Lead not found")
    try:
        result = leads_module.onboard_buyer(db, lead_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, f"Research failed: {exc}") from exc
    return {
        "buyer_id": result["buyer_id"],
        "score": result["score"],
        "reasoning": result["reasoning"],
        "next_actions": result["next_actions"],
    }
