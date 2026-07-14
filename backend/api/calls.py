from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, Response
from sqlalchemy.orm import Session

from api.deps import get_current_user, get_db
from api.schemas import (
    CallConfigRead,
    CallHistoryItem,
    CallHistoryListResponse,
    CallInitiateRequest,
    CallInitiateResponse,
    CallNotesRequest,
    ManualCallRequest,
    VoiceTokenRead,
)
from db.models import AppUser
from db.session import SessionLocal
from integrations.voice_client import voice_client
from modules import calls as calls_module
from modules import leads as leads_module

from config import settings


def _require_lead_access(db: Session, user: AppUser, lead_id: int) -> None:
    if not leads_module.user_can_access_buyer(db, user=user, buyer_id=lead_id):
        raise HTTPException(403, "You do not have access to this lead")

router = APIRouter(tags=["calls"])


def _twilio_webhook_url(request: Request) -> str:
    """URL Twilio signed — use public base behind ngrok/Railway, not internal http://."""
    base = (settings.twilio_webhook_base_url or "").rstrip("/")
    if base:
        path = request.url.path
        query = request.url.query
        return f"{base}{path}" + (f"?{query}" if query else "")
    url = str(request.url)
    if request.headers.get("x-forwarded-proto") == "https" and url.startswith("http://"):
        return "https://" + url[7:]
    return url


async def _twilio_form(request: Request) -> dict[str, str]:
    form = await request.form()
    params = {str(k): str(v) for k, v in form.items()}
    if voice_client.is_configured:
        signature = request.headers.get("X-Twilio-Signature", "")
        if not voice_client.validate_webhook(_twilio_webhook_url(request), params, signature):
            raise HTTPException(403, "Invalid Twilio signature")
    return params


def _transcribe_in_background(interaction_id: int) -> None:
    db = SessionLocal()
    try:
        calls_module.transcribe_call(db, interaction_id=interaction_id)
    except Exception:
        # Status/error already stored on the interaction when possible.
        pass
    finally:
        db.close()


@router.get("/calls/config", response_model=CallConfigRead)
def get_call_config():
    cfg = calls_module.call_config()
    return CallConfigRead(**cfg)


@router.get("/calls/voice-token", response_model=VoiceTokenRead)
def get_voice_token():
    try:
        result = calls_module.voice_access_token()
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    except Exception as exc:
        raise HTTPException(500, f"Voice token failed: {exc}") from exc
    return VoiceTokenRead(**result)


@router.get("/calls/history", response_model=CallHistoryListResponse)
def list_call_history(
    page: int = Query(1, ge=1),
    page_size: int = Query(5, ge=1, le=50),
    since_days: int = Query(calls_module.CALL_HISTORY_RETENTION_DAYS, ge=1, le=366),
    db: Session = Depends(get_db),
):
    result = calls_module.list_call_history(
        db,
        page=page,
        page_size=page_size,
        since_days=since_days,
    )
    return CallHistoryListResponse(
        total=int(result["total"]),
        page=int(result["page"]),
        page_size=int(result["page_size"]),
        total_pages=int(result["total_pages"]),
        since_days=result.get("since_days"),
        rows=[CallHistoryItem(**row) for row in result["rows"]],
    )


@router.get("/leads/{lead_id}/calls", response_model=CallHistoryListResponse)
def list_lead_calls(
    lead_id: int,
    page: int = Query(1, ge=1),
    page_size: int = Query(5, ge=1, le=50),
    since_days: int | None = Query(None, ge=1, le=366),
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    from modules.buyers import get_buyer

    _require_lead_access(db, user, lead_id)
    if not get_buyer(db, lead_id):
        raise HTTPException(404, "Lead not found")
    result = calls_module.list_call_history(
        db,
        buyer_id=lead_id,
        page=page,
        page_size=page_size,
        since_days=since_days,
    )
    return CallHistoryListResponse(
        total=int(result["total"]),
        page=int(result["page"]),
        page_size=int(result["page_size"]),
        total_pages=int(result["total_pages"]),
        since_days=result.get("since_days"),
        rows=[CallHistoryItem(**row) for row in result["rows"]],
    )


@router.patch("/calls/{interaction_id}/notes", response_model=CallHistoryItem)
def update_call_notes(
    interaction_id: int,
    payload: CallNotesRequest,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    try:
        result = calls_module.update_call_followup(
            db,
            interaction_id=interaction_id,
            notes=payload.notes,
            call_outcome=payload.call_outcome,
            app_user_id=user.id,
        )
    except ValueError as exc:
        raise HTTPException(400 if "Invalid call outcome" in str(exc) else 404, str(exc)) from exc
    return CallHistoryItem(**result)


@router.delete("/calls/{interaction_id}", status_code=204)
def delete_call_log(interaction_id: int, db: Session = Depends(get_db)):
    if not calls_module.delete_call_log(db, interaction_id=interaction_id):
        raise HTTPException(404, "Call not found")
    return Response(status_code=204)


@router.get("/calls/{interaction_id}/recording")
def get_call_recording(
    interaction_id: int,
    download: bool = Query(False),
    db: Session = Depends(get_db),
):
    try:
        path, content_type, filename = calls_module.get_call_recording_file(
            db, interaction_id=interaction_id
        )
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc

    headers = {}
    if download:
        headers["Content-Disposition"] = f'attachment; filename="{filename}"'
    else:
        headers["Content-Disposition"] = f'inline; filename="{filename}"'

    return FileResponse(
        path,
        media_type=content_type,
        filename=filename if download else None,
        headers=headers,
    )


@router.post("/calls/{interaction_id}/transcribe", response_model=CallHistoryItem)
def transcribe_call(
    interaction_id: int,
    background_tasks: BackgroundTasks,
    wait: bool = Query(False),
    db: Session = Depends(get_db),
):
    """Generate or refresh closed captions for a recorded call."""
    from db.models import Channel, Interaction

    interaction = db.get(Interaction, interaction_id)
    if not interaction or interaction.channel != Channel.phone:
        raise HTTPException(404, "Call not found")

    current = calls_module.call_interaction_to_dict(db, interaction)
    if not current.get("recording_available"):
        raise HTTPException(400, "No recording available for this call yet")

    if wait:
        try:
            result = calls_module.transcribe_call(db, interaction_id=interaction_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            raise HTTPException(502, str(exc)) from exc
        return CallHistoryItem(**result)

    background_tasks.add_task(_transcribe_in_background, interaction_id)
    current["transcript_status"] = "processing"
    current["transcript_error"] = None
    return CallHistoryItem(**current)


@router.post("/leads/{lead_id}/call", response_model=CallInitiateResponse)
def initiate_lead_call(
    lead_id: int,
    payload: CallInitiateRequest,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    from modules.buyers import get_buyer
    from modules import activity as activity_module

    _require_lead_access(db, user, lead_id)
    if not get_buyer(db, lead_id):
        raise HTTPException(404, "Lead not found")
    try:
        result = calls_module.initiate_lead_call(
            db,
            buyer_id=lead_id,
            contact_id=payload.contact_id,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    company = result.get("company_name") or f"Lead #{lead_id}"
    contact_name = result.get("contact_name") or "contact"
    phone = result.get("lead_phone") or ""
    activity_module.log_activity(
        db,
        user_id=user.id,
        activity_type=activity_module.CALL_LOGGED,
        title="Call logged",
        summary=f"Called {company} ({contact_name}" + (f", {phone}" if phone else "") + ")",
        entity_type="interaction",
        entity_id=result.get("id"),
        details={"buyer_id": lead_id, "company_name": company},
    )
    return CallInitiateResponse(**result)


@router.post("/calls/dial", response_model=CallInitiateResponse)
def initiate_manual_call(
    payload: ManualCallRequest,
    db: Session = Depends(get_db),
    user: AppUser = Depends(get_current_user),
):
    from modules import activity as activity_module

    try:
        result = calls_module.initiate_manual_call(
            db,
            phone=payload.phone,
            contact_name=payload.contact_name,
            country=payload.country,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    company = result.get("company_name") or "Manual dial"
    contact_name = result.get("contact_name") or payload.contact_name or "contact"
    phone = result.get("lead_phone") or payload.phone
    activity_module.log_activity(
        db,
        user_id=user.id,
        activity_type=activity_module.CALL_LOGGED,
        title="Call logged",
        summary=f"Called {company} ({contact_name}, {phone})",
        entity_type="interaction",
        entity_id=result.get("id"),
        details={"buyer_id": result.get("buyer_id"), "company_name": company},
    )
    return CallInitiateResponse(**result)


webhooks_router = APIRouter(prefix="/webhooks/twilio", tags=["twilio-webhooks"])


@webhooks_router.post("/voice/client-dial")
async def twilio_client_dial(request: Request):
    """TwiML: browser client connects → dial the lead directly."""
    params = await _twilio_form(request)
    lead_phone = params.get("To") or request.query_params.get("To")
    interaction_id = params.get("interaction_id") or request.query_params.get("interaction_id")

    if not lead_phone:
        return Response(
            content='<?xml version="1.0" encoding="UTF-8"?><Response><Say>Missing lead number.</Say></Response>',
            media_type="application/xml",
        )

    iid = 0
    if interaction_id:
        try:
            iid = int(interaction_id)
        except ValueError:
            iid = 0

    return Response(
        content=voice_client.client_dial_twiml(str(lead_phone), iid),
        media_type="application/xml",
    )


@webhooks_router.post("/voice/status")
async def twilio_call_status(request: Request, db: Session = Depends(get_db)):
    form = await _twilio_form(request)
    interaction_id = request.query_params.get("interaction_id")
    if not interaction_id:
        return {"ok": True}

    try:
        iid = int(interaction_id)
    except ValueError:
        return {"ok": True}

    # Dial action webhook uses DialCallStatus; parent call uses CallStatus
    status = str(
        form.get("DialCallStatus") or form.get("CallStatus") or "unknown"
    )
    duration = str(form.get("DialCallDuration") or form.get("CallDuration") or "") or None
    call_sid = str(form.get("CallSid") or "") or None

    calls_module.update_call_status(
        db,
        interaction_id=iid,
        call_status=status,
        call_duration=duration,
        call_sid=call_sid,
    )
    return {"ok": True}


@webhooks_router.post("/voice/recording")
async def twilio_call_recording(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Twilio posts here when a Dial recording is ready."""
    form = await _twilio_form(request)
    interaction_id = request.query_params.get("interaction_id")
    if not interaction_id:
        return {"ok": True}

    try:
        iid = int(interaction_id)
    except ValueError:
        return {"ok": True}

    recording_sid = str(form.get("RecordingSid") or "")
    recording_url = str(form.get("RecordingUrl") or "")
    recording_status = str(form.get("RecordingStatus") or "completed")
    recording_duration = str(form.get("RecordingDuration") or "") or None

    if not recording_sid or not recording_url:
        return {"ok": True}

    media = calls_module.save_call_recording(
        db,
        interaction_id=iid,
        recording_sid=recording_sid,
        recording_url=recording_url,
        recording_status=recording_status,
        recording_duration=recording_duration,
    )
    if media and media.get("local_path") and media.get("transcript_status") == "pending":
        background_tasks.add_task(_transcribe_in_background, iid)
    return {"ok": True}
