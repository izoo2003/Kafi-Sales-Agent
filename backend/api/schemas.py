from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


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
    market_role: str = "unknown"
    market_role_reasoning: Optional[str] = None
    market_role_confidence: Optional[float] = None
    producer_tier: Optional[str] = None
    producer_conversion_pct: Optional[float] = None
    producer_tier_reasoning: Optional[str] = None
    created_at: datetime


class QuotationEligibleLeadRead(BuyerRead):
    latest_score: str
    score_reasoning: str
    contact_email: str
    contact_name: Optional[str] = None


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


class ContactUpdate(BaseModel):
    full_name: Optional[str] = None
    designation: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    preferred_language: Optional[str] = None
    consent_status: Optional[str] = None
    date_of_birth: Optional[date] = None
    nationality: Optional[str] = None


class ConsentSummaryRead(BaseModel):
    total: int
    unknown: int
    granted: int
    denied: int
    with_birthday: int


class ComplianceContactRead(BaseModel):
    id: int
    buyer_id: int
    company_name: str
    country: Optional[str] = None
    full_name: str
    designation: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    date_of_birth: Optional[date] = None
    nationality: Optional[str] = None
    consent_status: str
    preferred_language: Optional[str] = None
    birthday_outreach_ok: bool = False


class BulkConsentUpdate(BaseModel):
    contact_ids: list[int] = Field(min_length=1)
    consent_status: str


class ContactRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    buyer_id: int
    full_name: str
    designation: Optional[str] = None
    email: Optional[str]
    phone: Optional[str]
    preferred_language: Optional[str]
    consent_status: str = "unknown"


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


class QuotationLineCreate(BaseModel):
    product_id: int
    quantity: float = Field(gt=0)
    price_tier: str = "standard"


class QuotationCreate(BaseModel):
    buyer_id: int
    lines: list[QuotationLineCreate] | None = None
    product_id: int | None = None
    quantity: float = Field(default=20, gt=0)
    price_tier: str = "standard"
    incoterms: str = "FOB"
    validity_days: int = 14

    @model_validator(mode="after")
    def normalize_lines(self) -> "QuotationCreate":
        if self.lines:
            return self
        if self.product_id is not None:
            self.lines = [
                QuotationLineCreate(
                    product_id=self.product_id,
                    quantity=self.quantity,
                    price_tier=self.price_tier,
                )
            ]
            return self
        raise ValueError("Provide lines or product_id")


class QuotationBatchCreate(BaseModel):
    quantity: float = Field(default=20, gt=0)
    incoterms: str = "FOB"
    max_quotes: int = Field(default=3, ge=1, le=10)


class QuotationLineRead(BaseModel):
    product_id: int
    product_name: Optional[str] = None
    quantity: float
    unit_price: float
    price_unit: Optional[str] = None
    line_total: float


class QuotationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    buyer_id: int
    product_id: Optional[int] = None
    quantity: Optional[float] = None
    unit_price: Optional[float] = None
    incoterms: Optional[str]
    validity_date: Optional[date]
    status: str
    pdf_path: Optional[str]
    buyer_name: Optional[str] = None
    product_name: Optional[str] = None
    price_unit: Optional[str] = None
    line_total: Optional[float] = None
    lines: list[QuotationLineRead] = Field(default_factory=list)
    grand_total: Optional[float] = None


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


class LeadTableRowRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    company_name: str
    country: Optional[str] = None
    industry: Optional[str] = None
    website_url: Optional[str] = None
    linkedin_company_url: Optional[str] = None
    source: Optional[str] = None
    created_at: datetime
    latest_score: Optional[str] = None
    score_reasoning: Optional[str] = None
    scored_at: Optional[datetime] = None
    contact_id: Optional[int] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    market_role: Optional[str] = "unknown"
    market_role_reasoning: Optional[str] = None
    producer_tier: Optional[str] = None
    producer_conversion_pct: Optional[float] = None
    producer_tier_reasoning: Optional[str] = None


class LeadTableRowUpdate(BaseModel):
    company_name: Optional[str] = None
    country: Optional[str] = None
    industry: Optional[str] = None
    website_url: Optional[str] = None
    linkedin_company_url: Optional[str] = None
    contact_id: Optional[int] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None


class LeadTableResponse(BaseModel):
    total: int
    filtered_count: int
    rows: list[LeadTableRowRead]


class LeadTableFiltersRead(BaseModel):
    countries: list[str]
    industries: list[str]
    sources: list[str]
    scores: list[str]
    market_roles: list[str]


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
    social_summary: Optional[str] = None
    relationship_context: Optional[str]
    signals: list[str]
    matched_categories: list[str] = []
    matched_products: list[dict[str, Any]] = []
    product_fit_score: int = 0
    market_role: str = "unknown"
    market_role_reasoning: Optional[str] = None
    market_role_confidence: Optional[float] = None
    producer_tier: Optional[str] = None
    producer_conversion_pct: Optional[float] = None
    producer_tier_reasoning: Optional[str] = None
    researched_at: Optional[datetime] = None


class DiscoveryRegionRead(BaseModel):
    code: str
    label: str
    group: str
    gl_code: str


class DiscoveryRegionsResponse(BaseModel):
    max_regions: int
    regions: list[DiscoveryRegionRead]


class DiscoverLeadsRequest(BaseModel):
    seed_lead_id: Optional[int] = None
    region_codes: list[str] = Field(default_factory=list, max_length=3)
    country: Optional[str] = None
    industry: Optional[str] = None
    industries: list[str] = Field(default_factory=list, max_length=3)
    categories: list[str] = Field(default_factory=list)
    limit: int = Field(default=15, ge=1, le=30)
    use_web_search: bool = True
    use_website_links: bool = True


class DiscoveryCandidateRead(BaseModel):
    candidate_id: str
    company_name: str
    website_url: Optional[str] = None
    email: str = "Not found"
    phone: str = "Not found"
    facebook_url: str = "Not found"
    instagram_url: str = "Not found"
    linkedin_url: str = "Not found"
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
    email: Optional[str] = None
    phone: Optional[str] = None
    facebook_url: Optional[str] = None
    instagram_url: Optional[str] = None
    linkedin_url: Optional[str] = None
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
