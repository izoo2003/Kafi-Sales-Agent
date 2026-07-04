from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import compliance, interactions, leads, quotations, scheduler
from config import settings
from db.session import SessionLocal
from db.seed import seed_sample_data
from jobs.daily_birthday_check import run as run_birthday_check
from jobs.follow_up_scheduler import run as run_follow_up_check
from jobs.national_day_check import run as run_national_day_check

apscheduler = BackgroundScheduler()


def _run_daily_job():
    db = SessionLocal()
    try:
        run_birthday_check(db)
        run_national_day_check(db)
        run_follow_up_check(db)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    db = SessionLocal()
    try:
        seed_sample_data(db)
    finally:
        db.close()

    apscheduler.add_job(_run_daily_job, "cron", hour=8, minute=0, id="daily_scheduler")
    apscheduler.start()
    yield
    apscheduler.shutdown(wait=False)


app = FastAPI(
    title="Kafi Commodities Sales Agent",
    description="International sales co-pilot API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(leads.router, prefix="/api")
app.include_router(compliance.router, prefix="/api")
app.include_router(quotations.router, prefix="/api")
app.include_router(interactions.router, prefix="/api")
app.include_router(scheduler.router, prefix="/api")


@app.get("/api/health")
def health():
    from integrations.email_client import email_client

    return {
        "status": "ok",
        "service": "kafi-sales-agent",
        "gmail_configured": email_client.is_configured,
    }
