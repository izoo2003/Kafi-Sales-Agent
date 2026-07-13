from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import (
    calls,
    chatbot,
    compliance,
    email_activity,
    email_attachments,
    email_templates,
    inbox,
    interactions,
    leads,
    scheduler,
)
from config import settings
from modules.lead_discovery import OLD_CLIENTS_IMPORT_PARSER
from db.migrate import run_migrations
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
    print("Applying database migrations…", flush=True)
    try:
        run_migrations()
    except Exception as exc:
        print(f"Database migration failed: {exc}", flush=True)
        raise
    print("Migrations complete.", flush=True)

    try:
        import twilio  # noqa: F401
        from integrations.voice_client import voice_client
        from modules.llm_client import llm_client

        llm_client.reset()
        gemini_chain = llm_client.model_chain()
        print(f"Gemini model chain: {', '.join(gemini_chain)}", flush=True)

        if voice_client.browser_ready:
            voice_client.create_access_token()
            print("Twilio browser calling ready.", flush=True)
        elif voice_client.is_configured:
            print(f"Twilio partially configured: {voice_client.setup_hints()['missing']}", flush=True)
    except ImportError:
        print(
            "WARNING: twilio package not installed — browser calling disabled. "
            "Run: pip install -r requirements.txt",
            flush=True,
        )
    except Exception as exc:
        print(f"WARNING: Twilio calling check failed: {exc}", flush=True)

    db = SessionLocal()
    try:
        seed_sample_data(db)
    finally:
        db.close()

    print("Application startup complete.", flush=True)

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
app.include_router(interactions.router, prefix="/api")
app.include_router(email_activity.router, prefix="/api")
app.include_router(email_templates.router, prefix="/api")
app.include_router(scheduler.router, prefix="/api")
app.include_router(calls.router, prefix="/api")
app.include_router(email_attachments.router, prefix="/api")
app.include_router(inbox.router, prefix="/api")
app.include_router(calls.webhooks_router, prefix="/api")
app.include_router(chatbot.router, prefix="/api")


OLD_CLIENTS_IMPORT_PARSER = "old_clients_v2"


@app.get("/api/health")
def health():
    from integrations.mail_client import mail_client
    from integrations.outlook_client import outlook_client
    from integrations.voice_client import voice_client

    return {
        "status": "ok",
        "service": "kafi-sales-agent",
        "old_clients_import_parser": OLD_CLIENTS_IMPORT_PARSER,
        "api_port": settings.api_port,
        "outlook_configured": outlook_client.is_configured,
        "mailbox_configured": outlook_client.is_configured,
        "outbound_email_configured": mail_client.is_configured,
        "twilio_configured": voice_client.is_configured,
        "twilio_webhooks_ready": voice_client.webhooks_ready,
        "twilio_browser_ready": voice_client.browser_ready,
    }
