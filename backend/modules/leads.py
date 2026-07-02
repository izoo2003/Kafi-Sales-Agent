from sqlalchemy.orm import Session

from db.models import LeadScore
from modules.orchestrator import Orchestrator
from modules.research import BuyerProfile, ResearchModule

_orchestrator = Orchestrator()
_research = ResearchModule()


def research_buyer(db: Session, buyer_id: int) -> BuyerProfile:
    return _research.research_buyer(db, buyer_id)


def score_buyer(db: Session, buyer_id: int) -> LeadScore:
    profile = _research.research_buyer(db, buyer_id)
    return _orchestrator.scoring.score(db, profile)


def onboard_buyer(db: Session, buyer_id: int) -> dict:
    return _orchestrator.handle_new_buyer(db, buyer_id)


def get_latest_score(db: Session, buyer_id: int) -> LeadScore | None:
    return (
        db.query(LeadScore)
        .filter(LeadScore.buyer_id == buyer_id)
        .order_by(LeadScore.scored_at.desc())
        .first()
    )


def list_quotation_eligible_leads(db: Session) -> list[dict]:
    """Buyers whose latest score is HOT or WARM."""
    from db.models import Buyer, LeadScoreLabel
    from modules import buyers as buyers_module

    eligible: list[dict] = []
    for buyer in buyers_module.list_buyers(db):
        score = get_latest_score(db, buyer.id)
        if score and score.score in (LeadScoreLabel.HOT, LeadScoreLabel.WARM):
            eligible.append(
                {
                    "id": buyer.id,
                    "company_name": buyer.company_name,
                    "country": buyer.country,
                    "industry": buyer.industry,
                    "website_url": buyer.website_url,
                    "source": buyer.source,
                    "created_at": buyer.created_at,
                    "latest_score": score.score.value,
                    "score_reasoning": score.reasoning,
                }
            )
    return eligible
