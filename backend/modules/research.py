from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import httpx
from bs4 import BeautifulSoup
from sqlalchemy.orm import Session

from db.models import Buyer, Contact, ExportHistory, Interaction
from modules.product_catalog import match_text_to_catalog
from modules.product_catalog import match_text_to_catalog


@dataclass
class BuyerProfile:
    buyer_id: int
    company_name: str
    website_url: str | None
    country: str | None
    industry: str | None
    website_summary: str | None = None
    social_summary: str | None = None
    relationship_context: str | None = None
    signals: list[str] = field(default_factory=list)
    matched_categories: list[str] = field(default_factory=list)
    matched_products: list[dict] = field(default_factory=list)
    product_fit_score: int = 0
    raw: dict[str, Any] = field(default_factory=dict)


class ResearchModule:
    """Fetches public website content and builds a structured buyer profile."""

    def __init__(self, timeout: float = 15.0):
        self.timeout = timeout

    def fetch_website_summary(
        self, url: str | None
    ) -> tuple[str | None, list[str], str]:
        if not url:
            return None, [], ""

        signals: list[str] = []
        try:
            response = httpx.get(url, timeout=self.timeout, follow_redirects=True)
            response.raise_for_status()
        except httpx.HTTPError as exc:
            return f"Could not fetch website: {exc}", signals, ""

        soup = BeautifulSoup(response.text, "html.parser")
        title = soup.title.string.strip() if soup.title and soup.title.string else ""
        paragraphs = [
            p.get_text(strip=True)
            for p in soup.find_all("p")
            if len(p.get_text(strip=True)) > 40
        ][:5]
        text_preview = " ".join(paragraphs)[:800]

        if title:
            signals.append(f"Page title: {title}")
        if "certif" in response.text.lower():
            signals.append("Certifications mentioned on website")
        if any(k in response.text.lower() for k in ("export", "international", "global")):
            signals.append("International/export language on website")

        summary = f"{title}. {text_preview}".strip() if title or text_preview else "No summary extracted."
        return summary, signals, response.text[:12000]

    def build_relationship_context(
        self, db: Session, buyer_id: int
    ) -> tuple[str | None, list[str]]:
        exports = (
            db.query(ExportHistory)
            .filter(ExportHistory.buyer_id == buyer_id)
            .order_by(ExportHistory.order_date.desc())
            .limit(5)
            .all()
        )
        interactions = (
            db.query(Interaction)
            .join(Contact, Interaction.contact_id == Contact.id)
            .filter(Contact.buyer_id == buyer_id)
            .order_by(Interaction.created_at.desc())
            .limit(10)
            .all()
        )

        signals: list[str] = []
        parts: list[str] = []

        if exports:
            latest = exports[0]
            parts.append(
                f"{len(exports)} past export(s); latest order on {latest.order_date}."
            )
            signals.append("Existing export history")
        else:
            parts.append("No prior export history on record.")

        if interactions:
            parts.append(f"{len(interactions)} logged interaction(s).")
            recent = interactions[0]
            if recent.created_at:
                days = (datetime.now(recent.created_at.tzinfo) - recent.created_at).days
                if days <= 30:
                    signals.append("Recent engagement within 30 days")
        else:
            parts.append("No logged interactions yet.")

        return " ".join(parts), signals

    def research_buyer(self, db: Session, buyer_id: int) -> BuyerProfile:
        buyer = db.get(Buyer, buyer_id)
        if not buyer:
            raise ValueError(f"Buyer {buyer_id} not found")

        website_summary, web_signals, website_text = self.fetch_website_summary(buyer.website_url)
        relationship_context, rel_signals = self.build_relationship_context(db, buyer_id)

        fit_text = " ".join(
            filter(
                None,
                [
                    buyer.company_name,
                    buyer.industry or "",
                    website_summary or "",
                    website_text,
                    relationship_context or "",
                ],
            )
        )
        product_fit = match_text_to_catalog(fit_text)
        all_signals = web_signals + rel_signals + product_fit.signals

        return BuyerProfile(
            buyer_id=buyer.id,
            company_name=buyer.company_name,
            website_url=buyer.website_url,
            country=buyer.country,
            industry=buyer.industry,
            website_summary=website_summary,
            social_summary=None,
            relationship_context=relationship_context,
            signals=all_signals,
            matched_categories=product_fit.matched_categories,
            matched_products=product_fit.matched_products,
            product_fit_score=product_fit.match_score,
            raw={
                "website_fetched": bool(buyer.website_url),
                "product_fit_score": product_fit.match_score,
                "matched_categories": product_fit.matched_categories,
                "matched_products": product_fit.matched_products,
            },
        )
