from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from db.models import Contact, ExportHistory, Interaction, LeadScore, LeadScoreLabel
from modules.research import BuyerProfile


class LeadScoringModule:
    """Rule-based lead scoring until LLM is enabled."""

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
