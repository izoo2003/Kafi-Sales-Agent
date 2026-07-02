from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


class BuyerCreate(BaseModel):
    company_name: str
    website_url: Optional[str] = None
    country: Optional[str] = None
    industry: Optional[str] = None
    linkedin_company_url: Optional[str] = None
    source: Optional[str] = "manual"


class BuyerRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    company_name: str
    website_url: Optional[str]
    country: Optional[str]
    industry: Optional[str]
    source: Optional[str]
    created_at: datetime


class QuotationEligibleLeadRead(BuyerRead):
    latest_score: str
    score_reasoning: str


class ContactCreate(BaseModel):
    buyer_id: int
    full_name: str
    designation: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    nationality: Optional[str] = None
    date_of_birth: Optional[date] = None
    preferred_language: Optional[str] = "en"
    consent_status: str = "unknown"


class ContactRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    buyer_id: int
    full_name: str
    email: Optional[str]
    phone: Optional[str]
    preferred_language: Optional[str]


class ProductCreate(BaseModel):
    name: str
    category: Optional[str] = None
    spec_sheet: Optional[dict[str, Any]] = None
    price_tiers: Optional[dict[str, Any]] = None
    moq: Optional[str] = None
    packaging_options: Optional[Any] = None
    certifications: Optional[Any] = None


class ProductRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    category: Optional[str]
    price_tiers: Optional[dict[str, Any]]
    moq: Optional[str]


class QuotationCreate(BaseModel):
    buyer_id: int
    product_id: int
    quantity: float = Field(gt=0)
    incoterms: str = "FOB"
    validity_days: int = 14
    price_tier: str = "standard"


class QuotationBatchCreate(BaseModel):
    quantity: float = Field(default=20, gt=0)
    incoterms: str = "FOB"
    max_quotes: int = Field(default=3, ge=1, le=5)


class QuotationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    buyer_id: int
    product_id: int
    quantity: float
    unit_price: float
    incoterms: Optional[str]
    validity_date: Optional[date]
    status: str
    pdf_path: Optional[str]


class InteractionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    contact_id: int
    channel: str
    direction: str
    subject: Optional[str]
    content: str
    status: str
    created_at: datetime


class InteractionApprove(BaseModel):
    content: Optional[str] = None
    approved_by: str = "sales_rep"
    send: bool = True


class InteractionApproveResponse(BaseModel):
    interaction: InteractionRead
    sent: bool
    send_status: Optional[str] = None
    send_message: Optional[str] = None


class EmailDraftRequest(BaseModel):
    contact_id: int
    goal: str
    product_name: Optional[str] = None


class ProductInterestItem(BaseModel):
    name: str
    category: Optional[str] = None


class ProductInterestEmailRequest(BaseModel):
    contact_id: Optional[int] = None
    products: list[ProductInterestItem] = Field(min_length=1)


class LeadScoreRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    buyer_id: int
    score: str
    reasoning: str
    scored_at: datetime


class BuyerProfileRead(BaseModel):
    buyer_id: int
    company_name: str
    website_url: Optional[str]
    country: Optional[str]
    industry: Optional[str]
    website_summary: Optional[str]
    relationship_context: Optional[str]
    signals: list[str]
    matched_categories: list[str] = []
    matched_products: list[dict[str, Any]] = []


class DiscoverLeadsRequest(BaseModel):
    seed_lead_id: Optional[int] = None
    country: Optional[str] = None
    industry: Optional[str] = None
    categories: list[str] = Field(default_factory=list)
    limit: int = Field(default=15, ge=1, le=30)
    use_web_search: bool = True
    use_website_links: bool = True


class DiscoveryCandidateRead(BaseModel):
    candidate_id: str
    company_name: str
    website_url: Optional[str] = None
    country: Optional[str] = None
    industry: Optional[str] = None
    source: str
    source_detail: str = ""
    match_reason: str = ""
    already_exists: bool = False


class DiscoverLeadsResponse(BaseModel):
    candidates: list[DiscoveryCandidateRead]
    sources_used: list[str] = Field(default_factory=list)
    messages: list[str] = Field(default_factory=list)
    search_query: Optional[str] = None


class DiscoverImportCandidate(BaseModel):
    company_name: str
    website_url: Optional[str] = None
    country: Optional[str] = None
    industry: Optional[str] = None
    source: Optional[str] = "discovery"


class DiscoverImportRequest(BaseModel):
    candidates: list[DiscoverImportCandidate] = Field(min_length=1)
    auto_onboard: bool = False


class DiscoverImportResponse(BaseModel):
    created_count: int
    skipped_count: int
    created: list[BuyerRead]
    skipped: list[dict[str, str]]
    onboard_results: list[dict[str, Any]] = Field(default_factory=list)
