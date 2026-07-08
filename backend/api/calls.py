from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from api.deps import get_db
from api.schemas import CallConfigRead, CallInitiateRequest, CallInitiateResponse
from integrations.voice_client import voice_client
from modules import calls as calls_module

router = APIRouter(tags=["calls"])


@router.get("/calls/config", response_model=CallConfigRead)
def get_call_config():
    cfg = calls_module.call_config()
    return CallConfigRead(
        configured=cfg["configured"],
        webhooks_ready=cfg["webhooks_ready"],
        has_default_agent_phone=cfg["default_agent_phone"],
    )


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
            agent_phone=payload.agent_phone,
            contact_id=payload.contact_id,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return CallInitiateResponse(**result)


webhooks_router = APIRouter(prefix="/webhooks/twilio", tags=["twilio-webhooks"])


@webhooks_router.post("/voice/connect")
async def twilio_connect_call(request: Request):
    """TwiML: when the agent answers, dial the lead."""
    params = dict(request.query_params)
    form = await request.form()
    lead_phone = params.get("To") or form.get("To")
    if not lead_phone:
        return Response(
            content='<?xml version="1.0" encoding="UTF-8"?><Response><Say>Missing lead number.</Say></Response>',
            media_type="application/xml",
        )
    return Response(
        content=voice_client.connect_twiml(str(lead_phone)),
        media_type="application/xml",
    )


@webhooks_router.post("/voice/status")
async def twilio_call_status(request: Request, db: Session = Depends(get_db)):
    form = await request.form()
    interaction_id = request.query_params.get("interaction_id")
    if not interaction_id:
        return {"ok": True}

    try:
        iid = int(interaction_id)
    except ValueError:
        return {"ok": True}

    calls_module.update_call_status(
        db,
        interaction_id=iid,
        call_status=str(form.get("CallStatus") or "unknown"),
        call_duration=str(form.get("CallDuration") or "") or None,
        call_sid=str(form.get("CallSid") or "") or None,
    )
    return {"ok": True}
