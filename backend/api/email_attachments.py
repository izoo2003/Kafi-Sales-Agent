from fastapi import APIRouter, File, HTTPException, UploadFile

from api.schemas import EmailAttachmentRead
from modules.email_attachments import MAX_FILES_PER_EMAIL, public_attachment, save_upload

router = APIRouter(prefix="/email", tags=["email-attachments"])


@router.post("/attachments", response_model=EmailAttachmentRead, status_code=201)
async def upload_email_attachment(file: UploadFile = File(...)):
    try:
        meta = await save_upload(file)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return EmailAttachmentRead(**public_attachment(meta))
