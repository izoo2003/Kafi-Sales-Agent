from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from api.deps import get_db
from api.schemas import (
    ProductCreate,
    ProductRead,
    QuotationBatchCreate,
    QuotationCreate,
    QuotationRead,
)
from db.models import LeadScoreLabel
from modules.audit import log_action
from modules.commerce import get_commerce
from modules.leads import get_latest_score

router = APIRouter(prefix="/quotations", tags=["quotations"])
commerce = get_commerce()
BACKEND_ROOT = Path(__file__).resolve().parents[1]


@router.get("", response_model=list[QuotationRead])
def list_quotations(
    buyer_id: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    return commerce.list_quotations(db, buyer_id=buyer_id)


@router.post("", response_model=QuotationRead, status_code=201)
def create_quotation(payload: QuotationCreate, db: Session = Depends(get_db)):
    score = get_latest_score(db, payload.buyer_id)
    if not score:
        raise HTTPException(400, "Lead must be scored before creating a quotation")
    if score.score not in (LeadScoreLabel.HOT, LeadScoreLabel.WARM):
        raise HTTPException(400, "Quotations can only be created for HOT or WARM leads")
    try:
        quotation = commerce.create_quotation(db, **payload.model_dump())
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    log_action(db, entity_type="quotation", entity_id=quotation.id, action="created")
    return quotation


@router.post("/for-lead/{lead_id}", response_model=list[QuotationRead], status_code=201)
def create_quotations_for_lead(
    lead_id: int,
    payload: QuotationBatchCreate | None = None,
    db: Session = Depends(get_db),
):
    options = payload or QuotationBatchCreate()
    try:
        quotations = commerce.create_quotations_for_scored_lead(
            db,
            lead_id,
            quantity=options.quantity,
            incoterms=options.incoterms,
            max_quotes=options.max_quotes,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    for quotation in quotations:
        log_action(db, entity_type="quotation", entity_id=quotation.id, action="auto_created")
    return quotations


@router.get("/products", response_model=list[ProductRead])
def list_products(db: Session = Depends(get_db)):
    return commerce.list_products(db)


@router.post("/products/sync")
def sync_products_from_catalog(db: Session = Depends(get_db)):
    result = commerce.sync_catalog_to_products(db)
    log_action(db, entity_type="product", entity_id=0, action="catalog_sync", details=result)
    return result


@router.post("/products", response_model=ProductRead, status_code=201)
def create_product(payload: ProductCreate, db: Session = Depends(get_db)):
    return commerce.create_product(db, payload.model_dump())


@router.get("/upsell/{lead_id}")
def upsell_recommendations(lead_id: int, db: Session = Depends(get_db)):
    return commerce.recommend_upsell(db, lead_id)


@router.get("/cross-sell/{lead_id}")
def cross_sell_recommendations(lead_id: int, db: Session = Depends(get_db)):
    return commerce.recommend_cross_sell_from_catalog(db, lead_id)


@router.get("/product-types")
def list_product_types():
    from modules.product_catalog import list_unique_product_types

    types = list_unique_product_types()
    return {"count": len(types), "product_types": types}


@router.get("/catalog")
def get_product_catalog():
    from modules.product_catalog import list_categories, load_catalog

    catalog = load_catalog()
    return {
        "brand": catalog.get("brand", "ESSENCE"),
        "product_count": catalog.get("product_count", 0),
        "categories": list_categories(),
    }


@router.get("/{quotation_id}/file")
def download_quotation_file(quotation_id: int, db: Session = Depends(get_db)):
    from db.models import Quotation

    quotation = db.get(Quotation, quotation_id)
    if not quotation or not quotation.pdf_path:
        raise HTTPException(404, "Quotation file not found")

    path = Path(quotation.pdf_path)
    if not path.is_absolute():
        path = BACKEND_ROOT / path
    if not path.exists():
        raise HTTPException(404, "Quotation file not found on disk")

    media_type = "application/pdf" if path.suffix.lower() == ".pdf" else "text/html"
    return FileResponse(path, media_type=media_type, filename=path.name)
