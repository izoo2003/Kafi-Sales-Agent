from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from api.deps import get_db
from api.schemas import (
    CallConfigRead,
    CallHistoryItem,
    CallInitiateRequest,
    CallInitiateResponse,
    CallNotesRequest,
    VoiceTokenRead,
)
from integrations.voice_client import voice_client
from modules import calls as calls_module

router = APIRouter(tags=["calls"])


async def _twilio_form(request: Request) -> dict[str, str]:
    form = await request.form()
    params = {str(k): str(v) for k, v in form.items()}
    if voice_client.is_configured:
        signature = request.headers.get("X-Twilio-Signature", "")
        if not voice_client.validate_webhook(str(request.url), params, signature):
            raise HTTPException(403, "Invalid Twilio signature")
    return params


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
    return VoiceTokenRead(**result)


@router.get("/calls/history", response_model=list[CallHistoryItem])
def list_call_history(limit: int = 50, db: Session = Depends(get_db)):
    rows = calls_module.list_call_history(db, limit=min(limit, 200))
    return [CallHistoryItem(**row) for row in rows]


@router.get("/leads/{lead_id}/calls", response_model=list[CallHistoryItem])
def list_lead_calls(lead_id: int, limit: int = 50, db: Session = Depends(get_db)):
    from modules.buyers import get_buyer

    if not get_buyer(db, lead_id):
        raise HTTPException(404, "Lead not found")
    rows = calls_module.list_call_history(db, buyer_id=lead_id, limit=min(limit, 200))
    return [CallHistoryItem(**row) for row in rows]


@router.patch("/calls/{interaction_id}/notes", response_model=CallHistoryItem)
def update_call_notes(
    interaction_id: int,
    payload: CallNotesRequest,
    db: Session = Depends(get_db),
):
    try:
        result = calls_module.update_call_notes(db, interaction_id=interaction_id, notes=payload.notes)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return CallHistoryItem(**result)


@router.post("/leads/{lead_id}/call", response_model=CallInitiateResponse)
def initiate_lead_call(
    lead_id: int,
    payload: CallInitiateRequest,
    db: Session = Depends(get_db),
):
    from modules.buyers import get_buyer

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
