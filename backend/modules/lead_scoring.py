from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from db.models import Contact, ExportHistory, Interaction, LeadScore, LeadScoreLabel
from modules.research import BuyerProfile


class LeadScoringModule:
    """Rule-based lead scoring with optional LLM-enhanced reasoning."""

    def score(self, db: Session, profile: BuyerProfile) -> LeadScore:
        factors: list[dict[str, str | int | float]] = []
        points = 0

        exports = (
            db.query(ExportHistory)
            .filter(ExportHistory.buyer_id == profile.buyer_id)
            .all()
        )
        if exports:
            points += 40
            factors.append({"factor": "export_history", "weight": 40, "note": f"{len(exports)} orders"})
            total_value = sum(
                float(e.quantity or 0) * float(e.unit_price or 0) for e in exports
            )
            if total_value > 100_000:
                points += 15
                factors.append({"factor": "order_value", "weight": 15, "note": "High lifetime value"})

        cutoff = datetime.now(timezone.utc) - timedelta(days=90)
        recent_interactions = (
            db.query(Interaction)
            .join(Contact, Interaction.contact_id == Contact.id)
            .filter(Contact.buyer_id == profile.buyer_id)
            .filter(Interaction.created_at >= cutoff)
            .count()
        )
        if recent_interactions:
            points += min(recent_interactions * 10, 30)
            factors.append(
                {
                    "factor": "recent_engagement",
                    "weight": min(recent_interactions * 10, 30),
                    "note": f"{recent_interactions} interactions in 90 days",
                }
            )

        for signal in profile.signals:
            if "Recent engagement" in signal:
                points += 10
                factors.append({"factor": "signal", "weight": 10, "note": signal})
            if "International/export" in signal:
                points += 5
                factors.append({"factor": "signal", "weight": 5, "note": signal})
            if signal.startswith("Product fit:"):
                points += 8
                factors.append({"factor": "product_fit", "weight": 8, "note": signal})

        if profile.raw.get("product_fit_score"):
            fit_pts = min(int(profile.raw["product_fit_score"]), 25)
            if fit_pts:
                points += fit_pts
                factors.append(
                    {
                        "factor": "kafi_catalog_match",
                        "weight": fit_pts,
                        "note": f"Matched Kafi categories: {', '.join(profile.matched_categories[:5]) or 'none'}",
                    }
                )

        role = profile.market_role or profile.raw.get("market_role") or "unknown"
        producer_tier = profile.producer_tier or profile.raw.get("producer_tier")
        conversion_pct = profile.producer_conversion_pct or profile.raw.get("producer_conversion_pct")

        if role == "consumer":
            points += 15
            factors.append(
                {
                    "factor": "market_role",
                    "weight": 15,
                    "note": "Classified as buyer/importer (consumer)",
                }
            )
        elif role == "producer":
            if producer_tier == "weak" and conversion_pct is not None:
                if conversion_pct >= 55:
                    points -= 5
                    factors.append(
                        {
                            "factor": "weak_producer_conversion",
                            "weight": -5,
                            "note": f"Weak producer with {conversion_pct:.0f}% white-label conversion potential",
                        }
                    )
                elif conversion_pct >= 40:
                    points -= 15
                    factors.append(
                        {
                            "factor": "weak_producer_conversion",
                            "weight": -15,
                            "note": f"Weak producer — moderate conversion potential ({conversion_pct:.0f}%)",
                        }
                    )
                else:
                    points -= 25
                    factors.append(
                        {
                            "factor": "weak_producer_conversion",
                            "weight": -25,
                            "note": f"Weak producer — low conversion potential ({conversion_pct:.0f}%)",
                        }
                    )
            else:
                points -= 35
                factors.append(
                    {
                        "factor": "market_role",
                        "weight": -35,
                        "note": "Strong producer/competitor — poor outreach target",
                    }
                )
        elif role == "hybrid":
            if producer_tier == "weak" and conversion_pct is not None and conversion_pct >= 50:
                points -= 5
                factors.append(
                    {
                        "factor": "hybrid_weak_producer",
                        "weight": -5,
                        "note": f"Hybrid with weak-producer profile ({conversion_pct:.0f}% conversion potential)",
                    }
                )
            else:
                points -= 10
                factors.append(
                    {
                        "factor": "market_role",
                        "weight": -10,
                        "note": "Mixed producer and buyer signals",
                    }
                )

        points = max(points, 0)

        role_note = ""
        if role == "producer":
            if producer_tier == "weak" and conversion_pct is not None:
                role_note = (
                    f" Weak producer — {conversion_pct:.0f}% chance to source additional Kafi ranges "
                    "(white-label / resale)."
                )
            else:
                role_note = " Strong producer/competitor — not an ideal buyer."
        elif role == "hybrid":
            role_note = " Mixed producer/buyer role — verify before outreach."

        if points >= 50:
            label = LeadScoreLabel.HOT
            if profile.matched_categories:
                reasoning = (
                    f"Strong fit: engagement/history plus Kafi product match "
                    f"({', '.join(profile.matched_categories[:3])}).{role_note}"
                )
            else:
                reasoning = f"Strong fit: recent engagement and/or meaningful order history.{role_note}"
        elif points >= 20:
            label = LeadScoreLabel.WARM
            if profile.matched_categories:
                reasoning = (
                    f"Some fit for Kafi products ({', '.join(profile.matched_categories[:3])}); "
                    f"nurture recommended.{role_note}"
                )
            else:
                reasoning = f"Some engagement or fit signals; nurture recommended.{role_note}"
        else:
            label = LeadScoreLabel.COLD
            if role == "producer":
                if producer_tier == "weak" and conversion_pct is not None and conversion_pct >= 45:
                    reasoning = (
                        f"Narrow producer — cross-sell opportunity ({conversion_pct:.0f}% estimated "
                        "conversion to source additional Kafi product lines)."
                    )
                else:
                    reasoning = (
                        "Classified as strong producer/competitor — weak buyer fit for Kafi export sales."
                    )
            else:
                reasoning = f"Limited engagement and weak Kafi product fit.{role_note}"

        # Enhance reasoning with LLM if available
        reasoning = self._maybe_llm_reasoning(
            db=db,
            profile=profile,
            fallback_label=label.value,
            fallback_reasoning=reasoning,
            score_factors=factors,
        )
        if isinstance(reasoning, dict):
            label = LeadScoreLabel(reasoning["score"])
            factors = reasoning.get("key_factors", factors)
            reasoning = reasoning["reasoning"]

        record = LeadScore(
            buyer_id=profile.buyer_id,
            score=label,
            reasoning=reasoning,
            score_factors={"points": points, "factors": factors},
        )
        db.add(record)
        db.commit()
        db.refresh(record)
        return record

    # ------------------------------------------------------------------
    # LLM enrichment (optional)
    # ------------------------------------------------------------------

    def _maybe_llm_reasoning(
        self,
        *,
        db: Session,
        profile: BuyerProfile,
        fallback_label: str,
        fallback_reasoning: str,
        score_factors: list,
    ) -> dict | str:
        """Return LLM-enriched {score, reasoning, key_factors} or the fallback string."""
        from modules.llm_client import llm_client
        if not llm_client.enabled:
            return fallback_reasoning

        # Build compact interaction + export summaries for the prompt
        cutoff = datetime.now(timezone.utc) - timedelta(days=90)
        interactions_rows = (
            db.query(Interaction)
            .join(Contact, Interaction.contact_id == Contact.id)
            .filter(Contact.buyer_id == profile.buyer_id)
            .filter(Interaction.created_at >= cutoff)
            .limit(5)
            .all()
        )
        exports_rows = (
            db.query(ExportHistory)
            .filter(ExportHistory.buyer_id == profile.buyer_id)
            .order_by(ExportHistory.order_date.desc())
            .limit(5)
            .all()
        )

        buyer_profile_str = (
            f"Company: {profile.company_name}\n"
            f"Country: {profile.country or 'unknown'}\n"
            f"Industry: {profile.industry or 'unknown'}\n"
            f"Market role: {profile.market_role}\n"
            f"Website summary: {profile.website_summary or 'n/a'}\n"
            f"Matched categories: {', '.join(profile.matched_categories) or 'none'}\n"
            f"Product fit score: {profile.product_fit_score}\n"
            f"Rule-based label: {fallback_label} — {fallback_reasoning}\n"
            f"Score factors: {score_factors}"
        )
        interactions_str = "\n".join(
            f"- [{i.channel}] {i.direction} on {i.created_at}: {(i.content or '')[:120]}"
            for i in interactions_rows
        ) or "None in last 90 days"
        exports_str = "\n".join(
            f"- {e.order_date}: qty {e.quantity} @ {e.unit_price}"
            for e in exports_rows
        ) or "No export history"

        return llm_client.score_lead(
            buyer_profile=buyer_profile_str,
            interactions=interactions_str,
            export_history=exports_str,
            fallback_label=fallback_label,
            fallback_reasoning=fallback_reasoning,
        )
