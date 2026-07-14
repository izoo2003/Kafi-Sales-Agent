from contextlib import asynccontextmanager

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api import (
    auth,
    calls,
    chatbot,
    compliance,
    email_activity,
    email_attachments,
    email_templates,
    inbox,
    interactions,
    kpi,
    leads,
    scheduler,
)
from config import settings
from modules.auth import ensure_default_admin
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
        from modules import calls as calls_module

        purged = calls_module.purge_old_call_logs(db)
        if purged:
            print(f"Purged {purged} call log(s) older than {calls_module.CALL_HISTORY_RETENTION_DAYS} days.", flush=True)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    import os
    from pathlib import Path

    # Railway start.sh migrates once before workers; skip here to avoid startup races.
    skip_migrate = os.environ.get("KAFI_SKIP_LIFESPAN_MIGRATE", "").lower() in {
        "1",
        "true",
        "yes",
    }
    if not skip_migrate:
        print("Applying database migrations…", flush=True)
        try:
            run_migrations()
        except Exception as exc:
            print(f"Database migration failed: {exc}", flush=True)
            raise
        print("Migrations complete.", flush=True)
    else:
        print("Skipping lifespan migrations (already applied by start.sh).", flush=True)

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

    # Seed/admin must not take down the whole process — that yields Railway 502s
    # which browsers misreport as CORS (no Access-Control headers on the proxy error).
    try:
        db = SessionLocal()
        try:
            seed_sample_data(db)
            ensure_default_admin(db)
        finally:
            db.close()
    except Exception as exc:
        print(f"WARNING: startup seed/admin failed: {exc}", flush=True)

    print("Application startup complete.", flush=True)

    # With --workers >1, only one process should own the daily scheduler.
    lock_path = Path("/tmp/kafi_apscheduler.lock")
    run_scheduler = True
    try:
        if lock_path.exists():
            run_scheduler = False
        else:
            lock_path.write_text(str(os.getpid()), encoding="utf-8")
    except OSError:
        run_scheduler = os.environ.get("KAFI_ENABLE_SCHEDULER", "true").lower() in {
            "1",
            "true",
            "yes",
        }

    if run_scheduler:
        apscheduler.add_job(_run_daily_job, "cron", hour=8, minute=0, id="daily_scheduler")
        apscheduler.start()
        print("Daily scheduler started in this worker.", flush=True)
    else:
        print("Daily scheduler skipped in this worker (another worker owns it).", flush=True)
    yield
    if run_scheduler:
        apscheduler.shutdown(wait=False)
        try:
            lock_path.unlink(missing_ok=True)
        except OSError:
            pass


app = FastAPI(
    title="Kafi Commodities Sales Agent",
    description="International sales co-pilot API",
    version="0.1.0",
    lifespan=lifespan,
)

_PUBLIC_API_PATHS = {"/api/health", "/api/auth/login"}
_PUBLIC_API_PREFIXES = ("/api/webhooks/",)


@app.middleware("http")
async def require_api_auth(request, call_next):
    """Require a valid bearer session for dashboard API routes."""
    if request.method == "OPTIONS":
        return await call_next(request)

    path = request.url.path
    if not path.startswith("/api/"):
        return await call_next(request)
    if path in _PUBLIC_API_PATHS or any(path.startswith(prefix) for prefix in _PUBLIC_API_PREFIXES):
        return await call_next(request)

    auth_header = request.headers.get("authorization") or ""
    scheme, _, token = auth_header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        from fastapi.responses import JSONResponse

        return JSONResponse(status_code=401, content={"detail": "Not authenticated"})

    from modules import auth as auth_module

    cached = auth_module.get_cached_auth(token.strip())
    if cached:
        request.state.user_id = cached[0]
        request.state.user_role = cached[1]
        return await call_next(request)

    db = SessionLocal()
    try:
        user = auth_module.get_user_by_token(db, token.strip())
        if not user:
            from fastapi.responses import JSONResponse

            return JSONResponse(status_code=401, content={"detail": "Not authenticated"})
        request.state.user_id = user.id
        request.state.user_role = user.role.value if hasattr(user.role, "value") else str(user.role)
    finally:
        db.close()

    return await call_next(request)


# CORS must be registered AFTER auth middleware so it stays outermost.
# Otherwise unauthenticated 401s skip CORS headers and the browser shows "Failed to fetch".
# Production origin listed explicitly; regex covers preview deployments (*.vercel.app).
_CORS_ORIGINS = list(
    dict.fromkeys(
        [
            *settings.cors_origin_list,
            "https://kafi-sales-agent.vercel.app",
        ]
    )
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(auth.router, prefix="/api")
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
app.include_router(kpi.router, prefix="/api")


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
