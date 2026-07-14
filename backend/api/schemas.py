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
    latest_score: Optional[str] = None
    score_reasoning: Optional[str] = None


class BuyerListResponse(BaseModel):
    total: int
    page: int = 1
    page_size: int = 20
    total_pages: int = 1
    rows: list[BuyerRead]


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
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    attachments: list["EmailAttachmentRead"] = Field(default_factory=list)


class EmailAttachmentRead(BaseModel):
    id: str
    filename: str
    content_type: str
    size: int


class InteractionAttachmentsUpdate(BaseModel):
    attachments: list[EmailAttachmentRead] = Field(default_factory=list)


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
    attachments: list[EmailAttachmentRead] = Field(default_factory=list)


class ManualEmailDraftRequest(BaseModel):
    buyer_id: int
    subject: str
    body: str
    contact_id: Optional[int] = None
    attachments: list[EmailAttachmentRead] = Field(default_factory=list)
    send: bool = True


class ManualEmailSendResponse(BaseModel):
    interaction: InteractionRead
    sent: bool
    send_status: Optional[str] = None
    send_message: Optional[str] = None


class EmailTemplateCreate(BaseModel):
    name: str
    subject: str
    body: str
    attachments: list[EmailAttachmentRead] = Field(default_factory=list)


class EmailTemplateUpdate(BaseModel):
    name: Optional[str] = None
    subject: Optional[str] = None
    body: Optional[str] = None
    attachments: Optional[list[EmailAttachmentRead]] = None


class EmailTemplateRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    subject: str
    body: str
    attachments: list[EmailAttachmentRead] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class EmailTemplatePreviewRead(BaseModel):
    subject: str
    body: str
    company_name: str
    contact_email: str


class EmailTextPreviewRequest(BaseModel):
    buyer_id: int
    subject: str
    body: str


class BulkManualEmailDraftRequest(BaseModel):
    buyer_ids: list[int] = Field(min_length=1)
    subject: str
    body: str
    attachments: list[EmailAttachmentRead] = Field(default_factory=list)
    send: bool = True


class BulkEmailDraftRequest(BaseModel):
    template_id: int
    buyer_ids: list[int] = Field(min_length=1)
    attachments: list[EmailAttachmentRead] = Field(default_factory=list)
    send: bool = True


class BulkEmailDraftResultItem(BaseModel):
    buyer_id: int
    company_name: str
    interaction_id: int
    contact_id: int
    sent: bool = False
    send_status: Optional[str] = None
    send_message: Optional[str] = None


class BulkEmailSkippedItem(BaseModel):
    buyer_id: int
    company_name: Optional[str] = None
    reason: str


class BulkEmailDraftResponse(BaseModel):
    created_count: int
    skipped_count: int
    sent_count: int = 0
    failed_count: int = 0
    created: list[BulkEmailDraftResultItem]
    skipped: list[BulkEmailSkippedItem]


class BulkApproveRequest(BaseModel):
    interaction_ids: list[int] = Field(min_length=1)
    approved_by: str = "sales_rep"
    send: bool = True


class BulkApproveResultItem(BaseModel):
    interaction_id: int
    status: str
    sent: bool
    send_status: Optional[str] = None
    send_message: Optional[str] = None


class BulkApproveResponse(BaseModel):
    processed: int
    sent_count: int
    failed_count: int
    results: list[BulkApproveResultItem]


class BulkEmailSettingsRead(BaseModel):
    batch_size: int
    message_delay_seconds: float
    batch_pause_seconds: float
    max_per_request: int
    gmail_daily_limit_hint: int = 500
    recommendation: str


class ProductInterestItem(BaseModel):
    name: str
    category: Optional[str] = None


class ProductInterestEmailRequest(BaseModel):
    contact_id: Optional[int] = None
    products: list[ProductInterestItem] = Field(min_length=1)
    attachments: list[EmailAttachmentRead] = Field(default_factory=list)


class LeadTableRowRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    company_name: str
    country: Optional[str] = None
    industry: Optional[str] = None
    website_url: Optional[str] = None
    linkedin_company_url: Optional[str] = None
    facebook_company_url: Optional[str] = None
    instagram_company_url: Optional[str] = None
    source: Optional[str] = None
    legacy_serial_no: Optional[int] = None
    company_grading: Optional[str] = None
    product_interest: Optional[str] = None
    city: Optional[str] = None
    address: Optional[str] = None
    remarks: Optional[str] = None
    assigned_to: str = "unassigned"
    assigned_to_user_id: Optional[int] = None
    follow_up_at: Optional[datetime] = None
    created_at: datetime
    latest_score: Optional[str] = None
    score_reasoning: Optional[str] = None
    scored_at: Optional[datetime] = None
    contact_id: Optional[int] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_designation: Optional[str] = None
    contact_secondary_mobile: Optional[str] = None
    contact_primary_phone: Optional[str] = None
    contact_secondary_phone: Optional[str] = None
    contact_secondary_email: Optional[str] = None
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
    facebook_company_url: Optional[str] = None
    instagram_company_url: Optional[str] = None
    legacy_serial_no: Optional[int] = None
    company_grading: Optional[str] = None
    product_interest: Optional[str] = None
    city: Optional[str] = None
    address: Optional[str] = None
    remarks: Optional[str] = None
    assigned_to: Optional[str] = None
    assigned_to_user_id: Optional[int] = None
    contact_id: Optional[int] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    contact_designation: Optional[str] = None
    contact_secondary_mobile: Optional[str] = None
    contact_primary_phone: Optional[str] = None
    contact_secondary_phone: Optional[str] = None
    contact_secondary_email: Optional[str] = None


class LeadTableResponse(BaseModel):
    total: int
    filtered_count: int
    page: int = 1
    page_size: int = 20
    total_pages: int = 1
    rows: list[LeadTableRowRead]


class LeadTableIdsResponse(BaseModel):
    filtered_count: int
    ids: list[int]


class DraftListResponse(BaseModel):
    total: int
    page: int = 1
    page_size: int = 20
    total_pages: int = 1
    rows: list[InteractionRead]


class EmailActivityEventRead(BaseModel):
    id: int
    event_type: str
    event_label: str
    severity: str
    title: str
    message: str
    buyer_id: Optional[int] = None
    contact_id: Optional[int] = None
    interaction_id: Optional[int] = None
    details: dict[str, Any] = Field(default_factory=dict)
    read_at: Optional[str] = None
    created_at: Optional[str] = None


class EmailActivityListResponse(BaseModel):
    total: int
    unread_count: int
    page: int = 1
    page_size: int = 30
    total_pages: int = 1
    rows: list[EmailActivityEventRead]


class EmailActivityMarkReadRequest(BaseModel):
    event_ids: list[int] = Field(default_factory=list)
    mark_all: bool = False


class EmailActivityCatalogItem(BaseModel):
    event_type: str
    label: str
    description: str
    severity: str


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
    limit: int = Field(default=15, ge=1, le=15)
    use_web_search: bool = True
    use_website_links: bool = True
    skip_enrichment: bool = False


class DiscoveryCandidateRead(BaseModel):
    candidate_id: str
    company_name: str
    website_url: Optional[str] = None
    contact_name: Optional[str] = None
    email: str = "Not found"
    phone: str = "Not found"
    facebook_url: str = "Not found"
    instagram_url: str = "Not found"
    linkedin_url: str = "Not found"
    country: Optional[str] = None
    industry: Optional[str] = None
    legacy_serial_no: Optional[int] = None
    company_grading: Optional[str] = None
    designation: Optional[str] = None
    secondary_mobile: Optional[str] = None
    primary_phone: Optional[str] = None
    secondary_phone: Optional[str] = None
    secondary_email: Optional[str] = None
    product_interest: Optional[str] = None
    city: Optional[str] = None
    address: Optional[str] = None
    remarks: Optional[str] = None
    source: str
    source_detail: str = ""
    match_reason: str = ""
    already_exists: bool = False
    is_valid_business: bool = True
    invalid_reason: Optional[str] = None


class DiscoverLeadsResponse(BaseModel):
    candidates: list[DiscoveryCandidateRead]
    sources_used: list[str] = Field(default_factory=list)
    messages: list[str] = Field(default_factory=list)
    search_query: Optional[str] = None
    import_parser: Optional[str] = None


class DiscoverImportCandidate(BaseModel):
    company_name: str
    website_url: Optional[str] = None
    contact_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    facebook_url: Optional[str] = None
    instagram_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    country: Optional[str] = None
    industry: Optional[str] = None
    legacy_serial_no: Optional[int] = None
    company_grading: Optional[str] = None
    designation: Optional[str] = None
    secondary_mobile: Optional[str] = None
    primary_phone: Optional[str] = None
    secondary_phone: Optional[str] = None
    secondary_email: Optional[str] = None
    product_interest: Optional[str] = None
    city: Optional[str] = None
    address: Optional[str] = None
    remarks: Optional[str] = None
    source: Optional[str] = "discovery"


class DiscoverImportRequest(BaseModel):
    candidates: list[DiscoverImportCandidate] = Field(min_length=1)
    auto_onboard: bool = False
    replace_duplicates: bool = False
    skip_enrichment: bool = False


class LeadTableDedupeGroup(BaseModel):
    company_name: str
    kept_id: int
    removed_ids: list[int]
    removed_names: list[str] = Field(default_factory=list)


class LeadTableDedupeResponse(BaseModel):
    removed_count: int
    kept_count: int
    groups: list[LeadTableDedupeGroup]


class LeadTableCleanupResponse(BaseModel):
    removed_count: int
    removed: list[dict[str, Any]] = Field(default_factory=list)


class DiscoverImportResponse(BaseModel):
    created_count: int
    skipped_count: int
    replaced_count: int = 0
    created: list[BuyerRead]
    skipped: list[dict[str, str]]
    replaced: list[dict[str, Any]] = Field(default_factory=list)
    onboard_results: list[dict[str, Any]] = Field(default_factory=list)


class CallConfigRead(BaseModel):
    configured: bool
    webhooks_ready: bool
    browser_ready: bool = False
    caller_id_masked: Optional[str] = None
    setup_message: Optional[str] = None
    missing_env: list[str] = Field(default_factory=list)


class VoiceTokenRead(BaseModel):
    token: str
    identity: str


class CallInitiateRequest(BaseModel):
    contact_id: Optional[int] = None


class ManualCallRequest(BaseModel):
    phone: str
    contact_name: Optional[str] = None
    country: Optional[str] = None


class CallInitiateResponse(InteractionRead):
    call_sid: Optional[str] = None
    call_status: Optional[str] = None
    lead_phone: Optional[str] = None
    message: Optional[str] = None


class CallHistoryItem(BaseModel):
    id: int
    contact_id: int
    buyer_id: Optional[int] = None
    company_name: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    channel: str = "phone"
    direction: str
    subject: Optional[str] = None
    content: Optional[str] = None
    status: str
    created_at: datetime
    call_sid: Optional[str] = None
    call_status: Optional[str] = None
    call_duration_seconds: Optional[int] = None
    lead_phone: Optional[str] = None
    notes: Optional[str] = None
    call_outcome: Optional[str] = None
    recording_available: bool = False
    recording_sid: Optional[str] = None
    recording_duration_seconds: Optional[int] = None
    recording_url: Optional[str] = None
    download_url: Optional[str] = None
    transcript: Optional[str] = None
    transcript_status: Optional[str] = None
    transcript_error: Optional[str] = None


class CallHistoryListResponse(BaseModel):
    total: int
    page: int = 1
    page_size: int = 5
    total_pages: int = 1
    since_days: Optional[int] = 30
    rows: list[CallHistoryItem]


class CallNotesRequest(BaseModel):
    notes: str = ""
    call_outcome: Optional[str] = None


class InterestedFollowUpRead(BaseModel):
    id: str
    buyer_id: int
    company_name: str
    contact_name: Optional[str] = None
    interested_at: datetime
    weeks_since_placement: int = 0
    days_since_placement: int = 0
    due_at: datetime
    call_outcome: Optional[str] = None
    table_section: Optional[str] = None


class InterestedFollowUpAckRead(BaseModel):
    buyer_id: int
    interested_follow_up_ack_at: datetime
    follow_up_at: Optional[datetime] = None


class FollowUpAtUpdate(BaseModel):
    follow_up_at: Optional[datetime] = None


class FollowUpAtRead(BaseModel):
    buyer_id: int
    follow_up_at: Optional[datetime] = None


# ── Inbox (Outlook) ───────────────────────────────────────────────────────────


class InboxMailboxStatus(BaseModel):
    provider: str
    email: Optional[str] = None
    configured: bool = True


class InboxStatus(BaseModel):
    configured: bool
    email: Optional[str] = None
    emails: list[str] = Field(default_factory=list)
    mailboxes: list[InboxMailboxStatus] = Field(default_factory=list)
    unread_count: int = 0
    showing_since: Optional[str] = None


class InboxUnreadCount(BaseModel):
    count: int


class InboxAttachment(BaseModel):
    filename: Optional[str] = None
    size: Optional[int] = None
    content_type: Optional[str] = None


class InboxMessageSummary(BaseModel):
    uid: str
    provider: Optional[str] = None
    subject: str
    from_email: Optional[str] = None
    from_name: Optional[str] = None
    date: Optional[datetime] = None
    preview: str = ""
    unread: bool = False
    has_attachments: bool = False
    message_id: Optional[str] = None


class InboxMessageDetail(InboxMessageSummary):
    to: list[str] = Field(default_factory=list)
    cc: list[str] = Field(default_factory=list)
    body_text: Optional[str] = None
    body_html: Optional[str] = None
    attachments: list[InboxAttachment] = Field(default_factory=list)


class InboxReplyRequest(BaseModel):
    body: str = Field(min_length=1)
    to: Optional[str] = None
    subject: Optional[str] = None
    cc: Optional[str] = None


class InboxReplyResponse(BaseModel):
    status: str
    message: str
    to: Optional[str] = None
    subject: Optional[str] = None


# ── Daily KPI Generation ──────────────────────────────────────────────────────


class KpiUserBrief(BaseModel):
    id: int
    username: str
    full_name: str
    role: str


class KpiCounts(BaseModel):
    calls_logged: int = 0
    outcomes_interested: int = 0
    outcomes_not_interested: int = 0
    outcomes_not_received_call: int = 0
    call_remarks: int = 0
    leads_imported: int = 0
    table_edits: int = 0
    email_templates_created: int = 0
    bulk_emails_sent: int = 0
    inbox_replies: int = 0
    brand_assistant_sessions: int = 0


class KpiActivityItem(BaseModel):
    id: int
    user_id: int
    username: Optional[str] = None
    full_name: Optional[str] = None
    activity_type: str
    title: str
    summary: str
    quantity: int = 1
    entity_type: Optional[str] = None
    entity_id: Optional[int] = None
    details: Optional[dict] = None
    created_at: datetime


class KpiPerUserSummary(BaseModel):
    user: Optional[KpiUserBrief] = None
    counts: KpiCounts
    activity_count: int = 0


class DailyKpiReportRead(BaseModel):
    date: str
    period: str = "day"
    date_start: Optional[str] = None
    date_end: Optional[str] = None
    timezone: str
    scope: str
    user: Optional[KpiUserBrief] = None
    counts: KpiCounts
    per_user: list[KpiPerUserSummary] = Field(default_factory=list)
    activities: list[KpiActivityItem] = Field(default_factory=list)
    activity_count: int = 0


class KpiSummaryRequest(BaseModel):
    date: date
    period: str = "day"
    user_id: Optional[int] = None


class KpiSummaryResponse(BaseModel):
    summary: str
    source: str
    subject: str
    report: DailyKpiReportRead
