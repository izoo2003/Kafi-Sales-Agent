from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from api.deps import get_db
from api.schemas import (
    BuyerCreate,
    BuyerProfileRead,
    BuyerRead,
    ContactCreate,
    ContactRead,
    DiscoverImportRequest,
    DiscoverImportResponse,
    DiscoverLeadsRequest,
    DiscoverLeadsResponse,
    DiscoveryCandidateRead,
    DiscoveryRegionsResponse,
    InteractionRead,
    LeadScoreRead,
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
from modules.discovery_regions import list_discovery_regions

router = APIRouter(prefix="/leads", tags=["leads"])


@router.get("", response_model=list[BuyerRead])
def list_leads(db: Session = Depends(get_db)):
    return buyers_module.list_buyers(db)


@router.post("", response_model=BuyerRead, status_code=201)
def create_lead(payload: BuyerCreate, db: Session = Depends(get_db)):
    buyer = buyers_module.create_buyer(db, payload.model_dump())
    log_action(db, entity_type="buyer", entity_id=buyer.id, action="created")
    return buyer


@router.get("/contacts", response_model=list[ContactRead])
def list_contacts(db: Session = Depends(get_db)):
    return buyers_module.list_contacts(db)


@router.post("/contacts", response_model=ContactRead, status_code=201)
def create_contact(payload: ContactCreate, db: Session = Depends(get_db)):
    return buyers_module.create_contact(db, payload.model_dump())


@router.get("/{lead_id}/contacts", response_model=list[ContactRead])
def list_lead_contacts(lead_id: int, db: Session = Depends(get_db)):
    buyer = buyers_module.get_buyer(db, lead_id)
    if not buyer:
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
            db, contact_id=contact.id, products=products
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
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(400, "Upload a .csv file")
    raw = await file.read()
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise HTTPException(400, "CSV must be UTF-8 encoded") from exc

    result = discover_from_csv(db, content, default_country=default_country)
    if result.messages and not result.candidates:
        raise HTTPException(400, result.messages[0])
    return DiscoverLeadsResponse(
        candidates=[DiscoveryCandidateRead(**c.to_dict()) for c in result.candidates],
        sources_used=result.sources_used,
        messages=result.messages,
        search_query=result.search_query,
    )


@router.post("/discover/import", response_model=DiscoverImportResponse)
def import_discovered_leads(payload: DiscoverImportRequest, db: Session = Depends(get_db)):
    result = import_candidates(
        db,
        [c.model_dump() for c in payload.candidates],
        auto_onboard=payload.auto_onboard,
    )
    return DiscoverImportResponse(
        created_count=result["created_count"],
        skipped_count=result["skipped_count"],
        created=result["created"],
        skipped=result["skipped"],
        onboard_results=result["onboard_results"],
    )


@router.get("/{lead_id}", response_model=BuyerRead)
def get_lead(lead_id: int, db: Session = Depends(get_db)):
    buyer = buyers_module.get_buyer(db, lead_id)
    if not buyer:
        raise HTTPException(404, "Lead not found")
    return buyer


@router.post("/{lead_id}/research", response_model=BuyerProfileRead)
def research_lead(lead_id: int, db: Session = Depends(get_db)):
    try:
        profile = leads_module.research_buyer(db, lead_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return BuyerProfileRead(
        buyer_id=profile.buyer_id,
        company_name=profile.company_name,
        website_url=profile.website_url,
        country=profile.country,
        industry=profile.industry,
        website_summary=profile.website_summary,
        relationship_context=profile.relationship_context,
        signals=profile.signals,
        matched_categories=profile.matched_categories,
        matched_products=profile.matched_products,
        market_role=profile.market_role,
        market_role_reasoning=profile.market_role_reasoning,
        market_role_confidence=profile.market_role_confidence,
        producer_tier=profile.producer_tier,
        producer_conversion_pct=profile.producer_conversion_pct,
        producer_tier_reasoning=profile.producer_tier_reasoning,
    )


@router.get("/{lead_id}/score", response_model=LeadScoreRead)
def get_latest_lead_score(lead_id: int, db: Session = Depends(get_db)):
    buyer = buyers_module.get_buyer(db, lead_id)
    if not buyer:
        raise HTTPException(404, "Lead not found")
    score = leads_module.get_latest_score(db, lead_id)
    if not score:
        raise HTTPException(404, "No score on record for this lead")
    return score


@router.post("/{lead_id}/score", response_model=LeadScoreRead)
def score_lead(lead_id: int, db: Session = Depends(get_db)):
    try:
        return leads_module.score_buyer(db, lead_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/{lead_id}/onboard")
def onboard_lead(lead_id: int, db: Session = Depends(get_db)):
    try:
        result = leads_module.onboard_buyer(db, lead_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {
        "buyer_id": result["buyer_id"],
        "score": result["score"],
        "reasoning": result["reasoning"],
        "next_actions": result["next_actions"],
    }
