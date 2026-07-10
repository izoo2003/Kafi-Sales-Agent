import enum
from datetime import date, datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Channel(str, enum.Enum):
    email = "email"
    whatsapp = "whatsapp"
    phone = "phone"
    linkedin = "linkedin"
    facebook = "facebook"
    instagram = "instagram"


class Direction(str, enum.Enum):
    inbound = "inbound"
    outbound = "outbound"


class HandledBy(str, enum.Enum):
    agent = "agent"
    human = "human"


class InteractionStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"
    sent = "sent"
    rejected = "rejected"


class LeadScoreLabel(str, enum.Enum):
    HOT = "HOT"
    WARM = "WARM"
    COLD = "COLD"


class QuotationStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"
    sent = "sent"
    expired = "expired"


class ExportStatus(str, enum.Enum):
    pending = "pending"
    shipped = "shipped"
    delivered = "delivered"
    cancelled = "cancelled"


class ConsentStatus(str, enum.Enum):
    unknown = "unknown"
    granted = "granted"
    denied = "denied"


class MarketRole(str, enum.Enum):
    consumer = "consumer"
    producer = "producer"
    hybrid = "hybrid"
    unknown = "unknown"


class ProducerTier(str, enum.Enum):
    strong = "strong"
    weak = "weak"


class EventType(str, enum.Enum):
    birthday = "birthday"
    national_day = "national_day"
    follow_up = "follow_up"
    promotion_congrats = "promotion_congrats"


class ScheduledEventStatus(str, enum.Enum):
    pending = "pending"
    draft_created = "draft_created"
    completed = "completed"
    skipped = "skipped"


class Buyer(Base):
    __tablename__ = "buyers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_name: Mapped[str] = mapped_column(String(255), nullable=False)
    website_url: Mapped[Optional[str]] = mapped_column(String(512))
    country: Mapped[Optional[str]] = mapped_column(String(100))
    industry: Mapped[Optional[str]] = mapped_column(String(255))
    linkedin_company_url: Mapped[Optional[str]] = mapped_column(String(512))
    facebook_company_url: Mapped[Optional[str]] = mapped_column(String(512))
    instagram_company_url: Mapped[Optional[str]] = mapped_column(String(512))
    source: Mapped[Optional[str]] = mapped_column(String(100))
    legacy_serial_no: Mapped[Optional[int]] = mapped_column(Integer)
    company_grading: Mapped[Optional[str]] = mapped_column(String(50))
    product_interest: Mapped[Optional[str]] = mapped_column(String(512))
    city: Mapped[Optional[str]] = mapped_column(String(255))
    address: Mapped[Optional[str]] = mapped_column(Text)
    remarks: Mapped[Optional[str]] = mapped_column(Text)
    market_role: Mapped[MarketRole] = mapped_column(
        Enum(MarketRole), default=MarketRole.unknown, nullable=False
    )
    market_role_reasoning: Mapped[Optional[str]] = mapped_column(Text)
    market_role_confidence: Mapped[Optional[float]] = mapped_column(Numeric(4, 2))
    producer_tier: Mapped[Optional["ProducerTier"]] = mapped_column(Enum(ProducerTier))
    producer_conversion_pct: Mapped[Optional[float]] = mapped_column(Numeric(5, 2))
    producer_tier_reasoning: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    contacts: Mapped[list["Contact"]] = relationship(back_populates="buyer")
    export_history: Mapped[list["ExportHistory"]] = relationship(back_populates="buyer")
    lead_scores: Mapped[list["LeadScore"]] = relationship(back_populates="buyer")
    quotations: Mapped[list["Quotation"]] = relationship(back_populates="buyer")
    research_profile: Mapped[Optional["BuyerResearchProfile"]] = relationship(
        back_populates="buyer",
        uselist=False,
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class BuyerResearchProfile(Base):
    __tablename__ = "buyer_research_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    buyer_id: Mapped[int] = mapped_column(
        ForeignKey("buyers.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    website_summary: Mapped[Optional[str]] = mapped_column(Text)
    social_summary: Mapped[Optional[str]] = mapped_column(Text)
    relationship_context: Mapped[Optional[str]] = mapped_column(Text)
    signals: Mapped[list] = mapped_column(JSONB, default=list)
    matched_categories: Mapped[list] = mapped_column(JSONB, default=list)
    matched_products: Mapped[list] = mapped_column(JSONB, default=list)
    product_fit_score: Mapped[int] = mapped_column(Integer, default=0)
    raw: Mapped[Optional[dict]] = mapped_column(JSONB)
    researched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    buyer: Mapped["Buyer"] = relationship(back_populates="research_profile")


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("buyers.id"), nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    designation: Mapped[Optional[str]] = mapped_column(String(255))
    email: Mapped[Optional[str]] = mapped_column(String(255))
    phone: Mapped[Optional[str]] = mapped_column(String(50))
    secondary_mobile: Mapped[Optional[str]] = mapped_column(String(50))
    primary_phone: Mapped[Optional[str]] = mapped_column(String(50))
    secondary_phone: Mapped[Optional[str]] = mapped_column(String(50))
    secondary_email: Mapped[Optional[str]] = mapped_column(String(255))
    linkedin_profile_url: Mapped[Optional[str]] = mapped_column(String(512))
    nationality: Mapped[Optional[str]] = mapped_column(String(100))
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date)
    preferred_language: Mapped[Optional[str]] = mapped_column(String(50), default="en")
    consent_status: Mapped[ConsentStatus] = mapped_column(
        Enum(ConsentStatus), default=ConsentStatus.unknown, nullable=False
    )
    data_source: Mapped[Optional[str]] = mapped_column(String(100))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    buyer: Mapped["Buyer"] = relationship(back_populates="contacts")
    interactions: Mapped[list["Interaction"]] = relationship(back_populates="contact")
    scheduled_events: Mapped[list["ScheduledEvent"]] = relationship(back_populates="contact")


class Product(Base):
    __tablename__ = "products"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[Optional[str]] = mapped_column(String(100))
    spec_sheet: Mapped[Optional[dict]] = mapped_column(JSONB)
    price_tiers: Mapped[Optional[dict]] = mapped_column(JSONB)
    moq: Mapped[Optional[str]] = mapped_column(String(100))
    packaging_options: Mapped[Optional[dict]] = mapped_column(JSONB)
    certifications: Mapped[Optional[dict]] = mapped_column(JSONB)

    export_history: Mapped[list["ExportHistory"]] = relationship(back_populates="product")
    quotations: Mapped[list["Quotation"]] = relationship(back_populates="product")
    quotation_line_items: Mapped[list["QuotationLineItem"]] = relationship(
        back_populates="product"
    )


class ExportHistory(Base):
    __tablename__ = "export_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("buyers.id"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    order_date: Mapped[date] = mapped_column(Date, nullable=False)
    quantity: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    unit_price: Mapped[Optional[float]] = mapped_column(Numeric(12, 2))
    destination_port: Mapped[Optional[str]] = mapped_column(String(255))
    incoterms: Mapped[Optional[str]] = mapped_column(String(20))
    status: Mapped[ExportStatus] = mapped_column(Enum(ExportStatus), default=ExportStatus.pending)

    buyer: Mapped["Buyer"] = relationship(back_populates="export_history")
    product: Mapped["Product"] = relationship(back_populates="export_history")


class Interaction(Base):
    __tablename__ = "interactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id"), nullable=False)
    channel: Mapped[Channel] = mapped_column(Enum(Channel), nullable=False)
    direction: Mapped[Direction] = mapped_column(Enum(Direction), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    subject: Mapped[Optional[str]] = mapped_column(String(500))
    sentiment: Mapped[Optional[str]] = mapped_column(String(50))
    language: Mapped[Optional[str]] = mapped_column(String(50))
    handled_by: Mapped[HandledBy] = mapped_column(Enum(HandledBy), default=HandledBy.agent)
    status: Mapped[InteractionStatus] = mapped_column(
        Enum(InteractionStatus), default=InteractionStatus.draft
    )
    approved_by: Mapped[Optional[str]] = mapped_column(String(255))
    attachments: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    contact: Mapped["Contact"] = relationship(back_populates="interactions")


class LeadScore(Base):
    __tablename__ = "lead_scores"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("buyers.id"), nullable=False)
    score: Mapped[LeadScoreLabel] = mapped_column(Enum(LeadScoreLabel), nullable=False)
    reasoning: Mapped[str] = mapped_column(Text, nullable=False)
    score_factors: Mapped[Optional[dict]] = mapped_column(JSONB)
    scored_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    buyer: Mapped["Buyer"] = relationship(back_populates="lead_scores")


class Quotation(Base):
    __tablename__ = "quotations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    buyer_id: Mapped[int] = mapped_column(ForeignKey("buyers.id"), nullable=False)
    product_id: Mapped[Optional[int]] = mapped_column(ForeignKey("products.id"), nullable=True)
    quantity: Mapped[Optional[float]] = mapped_column(Numeric(12, 2), nullable=True)
    unit_price: Mapped[Optional[float]] = mapped_column(Numeric(12, 2), nullable=True)
    incoterms: Mapped[Optional[str]] = mapped_column(String(20))
    validity_date: Mapped[Optional[date]] = mapped_column(Date)
    status: Mapped[QuotationStatus] = mapped_column(Enum(QuotationStatus), default=QuotationStatus.draft)
    pdf_path: Mapped[Optional[str]] = mapped_column(String(512))
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    buyer: Mapped["Buyer"] = relationship(back_populates="quotations")
    product: Mapped[Optional["Product"]] = relationship(back_populates="quotations")
    line_items: Mapped[list["QuotationLineItem"]] = relationship(
        back_populates="quotation",
        cascade="all, delete-orphan",
        order_by="QuotationLineItem.sort_order",
    )


class QuotationLineItem(Base):
    __tablename__ = "quotation_line_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    quotation_id: Mapped[int] = mapped_column(ForeignKey("quotations.id", ondelete="CASCADE"), nullable=False)
    product_id: Mapped[int] = mapped_column(ForeignKey("products.id"), nullable=False)
    quantity: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    unit_price: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    quotation: Mapped["Quotation"] = relationship(back_populates="line_items")
    product: Mapped["Product"] = relationship(back_populates="quotation_line_items")


class ScheduledEvent(Base):
    __tablename__ = "scheduled_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id"), nullable=False)
    event_type: Mapped[EventType] = mapped_column(Enum(EventType), nullable=False)
    trigger_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[ScheduledEventStatus] = mapped_column(
        Enum(ScheduledEventStatus), default=ScheduledEventStatus.pending
    )
    message_draft: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    contact: Mapped["Contact"] = relationship(back_populates="scheduled_events")


class EmailTemplate(Base):
    __tablename__ = "email_templates"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    subject: Mapped[str] = mapped_column(String(500), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    attachments: Mapped[list] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    entity_type: Mapped[str] = mapped_column(String(100), nullable=False)
    entity_id: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(100), nullable=False)
    actor: Mapped[Optional[str]] = mapped_column(String(255))
    details: Mapped[Optional[dict]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
