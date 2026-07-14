"""KPI Generation API — day / week / month activity reports + shareable summaries."""

from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from api.deps import get_current_user, get_db
from api.schemas import DailyKpiReportRead, KpiSummaryRequest, KpiSummaryResponse
from db.models import AppUser
from modules import activity as activity_module

router = APIRouter(prefix="/kpi", tags=["kpi"])


@router.get("/daily", response_model=DailyKpiReportRead)
def get_kpi_report(
    report_date: date = Query(
        ...,
        alias="date",
        description="Anchor date in Asia/Karachi (day itself, or any day in week/month)",
    ),
    period: str = Query(
        "day",
        description="Report range: day | week | month",
    ),
    user_id: int | None = Query(
        None,
        description="Admin only: filter to one user. Omit for team rollup.",
    ),
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    try:
        result = activity_module.get_kpi_report(
            db,
            report_date=report_date,
            viewer=user,
            user_id=user_id,
            period=period,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return DailyKpiReportRead(**result)


@router.post("/summary", response_model=KpiSummaryResponse)
def create_kpi_summary(
    payload: KpiSummaryRequest,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    try:
        result = activity_module.generate_kpi_summary(
            db,
            report_date=payload.date,
            viewer=user,
            user_id=payload.user_id,
            period=payload.period,
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return KpiSummaryResponse(
        summary=result["summary"],
        source=result["source"],
        subject=result["subject"],
        report=DailyKpiReportRead(**result["report"]),
    )
