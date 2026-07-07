from sqlalchemy.orm import Session

from db.models import (
    Buyer,
    Channel,
    Contact,
    Direction,
    HandledBy,
    Interaction,
    InteractionStatus,
)
from integrations.email_client import email_client


class CommsGenerator:
    """Template-based draft messages. LLM generation plugs in later."""

    def generate_email_draft(
        self,
        db: Session,
        *,
        contact_id: int,
        goal: str,
        product_name: str | None = None,
    ) -> Interaction:
        contact = db.get(Contact, contact_id)
        if not contact:
            raise ValueError("Contact not found")
        buyer = db.get(Buyer, contact.buyer_id)

        company = buyer.company_name if buyer else "your company"
        subject = f"Kafi Commodities — {goal}"

        # Template fallback
        fallback = (
            f"Dear {contact.full_name},\n\n"
            f"I hope this message finds you well. Following up regarding {goal.lower()} "
            f"for {company}."
        )
        if product_name:
            fallback += f"\n\nWe would be pleased to discuss our {product_name} offering."
        fallback += (
            "\n\nPlease let us know a convenient time to connect.\n\n"
            "Best regards,\nKafi Commodities Sales Team"
        )

        from modules.llm_client import llm_client
        buyer_context = (
            f"Buyer: {company}, Country: {getattr(buyer, 'country', 'unknown')}, "
            f"Industry: {getattr(buyer, 'industry', 'unknown')}"
        )
        body = llm_client.draft_email(
            buyer_country=getattr(buyer, "country", "") or "",
            target_language=contact.preferred_language or "en",
            buyer_context=buyer_context,
            goal=goal,
            product_specs=product_name or "Kafi ESSENCE range",
            fallback_body=fallback,
        )

        draft = Interaction(
            contact_id=contact_id,
            channel=Channel.email,
            direction=Direction.outbound,
            subject=subject,
            content=body,
            language=contact.preferred_language or "en",
            handled_by=HandledBy.agent,
            status=InteractionStatus.draft,
        )
        db.add(draft)
        db.commit()
        db.refresh(draft)
        return draft

    def generate_product_interest_email(
        self,
        db: Session,
        *,
        contact_id: int,
        products: list[dict[str, str]],
    ) -> Interaction:
        contact = db.get(Contact, contact_id)
        if not contact:
            raise ValueError("Contact not found")
        if not contact.email:
            raise ValueError("Contact has no email address")

        buyer = db.get(Buyer, contact.buyer_id)
        company = buyer.company_name if buyer else "your company"

        lines = []
        for item in products:
            name = item.get("name", "")
            category = item.get("category", "")
            if category:
                cat_label = category.replace("_", " ").title()
                lines.append(f"• {name} ({cat_label})")
            else:
                lines.append(f"• {name}")

        product_block = "\n".join(lines)
        subject = f"Kafi Commodities — ESSENCE products for {company}"
        fallback_body = (
            f"Dear {contact.full_name},\n\n"
            f"I hope this message finds you well. Based on what we know about "
            f"{company}, we believe the following products from our Kafi ESSENCE "
            f"range may be a good fit for your business:\n\n"
            f"{product_block}\n\n"
            f"We would be pleased to share specifications, packaging options, and "
            f"pricing tailored to your market. Let us know which lines you would "
            f"like to explore further.\n\n"
            f"Best regards,\nKafi Commodities Sales Team"
        )

        from modules.llm_client import llm_client
        buyer_context = (
            f"Buyer: {company}, Country: {getattr(buyer, 'country', 'unknown')}, "
            f"Industry: {getattr(buyer, 'industry', 'unknown')}"
        )
        product_specs = product_block
        body = llm_client.draft_email(
            buyer_country=getattr(buyer, "country", "") or "",
            target_language=contact.preferred_language or "en",
            buyer_context=buyer_context,
            goal="introduce Kafi ESSENCE product range",
            product_specs=product_specs,
            fallback_body=fallback_body,
        )

        draft = Interaction(
            contact_id=contact_id,
            channel=Channel.email,
            direction=Direction.outbound,
            subject=subject,
            content=body,
            language=contact.preferred_language or "en",
            handled_by=HandledBy.agent,
            status=InteractionStatus.draft,
        )
        db.add(draft)
        db.commit()
        db.refresh(draft)
        return draft

    def generate_quotation_email(
        self,
        db: Session,
        *,
        contact_id: int,
        buyer_name: str,
        product_name: str,
        quantity: float,
        unit_price: float,
        unit_label: str,
        line_total: float,
        incoterms: str | None,
        validity_date,
        lines: list[dict] | None = None,
    ) -> Interaction:
        contact = db.get(Contact, contact_id)
        if not contact:
            raise ValueError("Contact not found")
        if not contact.email:
            raise ValueError("Contact has no email address")

        if lines and len(lines) > 1:
            subject = f"Kafi Commodities — Quotation for {buyer_name}"
            product_lines = "\n".join(
                f"- {row['product_name']}: {row['quantity']} @ {row['unit_price']} "
                f"({row.get('price_unit') or unit_label}) = USD {row['line_total']:,.2f}"
                for row in lines
            )
            body = (
                f"Dear {contact.full_name},\n\n"
                f"Please find below our quotation for {buyer_name}.\n\n"
                f"{product_lines}\n\n"
                f"Grand total: USD {line_total:,.2f}\n"
                f"Incoterms: {incoterms or 'FOB'}\n"
                f"Validity: {validity_date}\n\n"
                f"We can share specification sheets and arrange samples on request.\n\n"
                f"Best regards,\nKafi Commodities Export Team"
            )
        else:
            subject = f"Kafi Commodities — Quotation for {product_name}"
            body = (
                f"Dear {contact.full_name},\n\n"
                f"Please find below our quotation for {product_name} "
                f"for {buyer_name}.\n\n"
                f"Product: {product_name}\n"
                f"Quantity: {quantity}\n"
                f"Unit price: {unit_price} ({unit_label})\n"
                f"Incoterms: {incoterms or 'FOB'}\n"
                f"Line total: USD {line_total:,.2f}\n"
                f"Validity: {validity_date}\n\n"
                f"We can share the full specification sheet and arrange samples on request.\n\n"
                f"Best regards,\nKafi Commodities Export Team"
            )
        draft = Interaction(
            contact_id=contact_id,
            channel=Channel.email,
            direction=Direction.outbound,
            subject=subject,
            content=body,
            language=contact.preferred_language or "en",
            handled_by=HandledBy.agent,
            status=InteractionStatus.draft,
        )
        db.add(draft)
        db.commit()
        db.refresh(draft)
        return draft

    def generate_whatsapp_reply(
        self,
        db: Session,
        *,
        contact_id: int,
        inbound_message: str,
    ) -> Interaction:
        contact = db.get(Contact, contact_id)
        if not contact:
            raise ValueError("Contact not found")

        reply = (
            f"Thank you for your message. We have received your inquiry and "
            f"will respond with details shortly.\n\n(Original: {inbound_message[:200]})"
        )
        draft = Interaction(
            contact_id=contact_id,
            channel=Channel.whatsapp,
            direction=Direction.outbound,
            content=reply,
            language=contact.preferred_language or "en",
            handled_by=HandledBy.agent,
            status=InteractionStatus.draft,
        )
        db.add(draft)
        db.commit()
        db.refresh(draft)
        return draft

    def approve_draft(
        self,
        db: Session,
        interaction_id: int,
        *,
        content: str | None = None,
        approved_by: str = "sales_rep",
        send: bool = True,
    ) -> tuple[Interaction, dict | None]:
        draft = db.get(Interaction, interaction_id)
        if not draft:
            raise ValueError("Interaction not found")
        if draft.status not in (InteractionStatus.draft, InteractionStatus.approved):
            raise ValueError(f"Cannot approve interaction in status {draft.status}")

        if content:
            draft.content = content
        draft.status = InteractionStatus.approved
        draft.approved_by = approved_by
        db.commit()
        db.refresh(draft)

        send_result: dict | None = None
        if send and draft.channel == Channel.email:
            contact = db.get(Contact, draft.contact_id)
            if not contact or not contact.email:
                raise ValueError("Contact has no email address — cannot send")

            send_result = email_client.send_approved(
                to=contact.email,
                subject=draft.subject or "Kafi Commodities",
                body=draft.content,
            )
            if send_result.get("status") == "sent":
                draft.status = InteractionStatus.sent
                db.commit()
                db.refresh(draft)

        return draft, send_result

    def reject_draft(self, db: Session, interaction_id: int) -> Interaction:
        draft = db.get(Interaction, interaction_id)
        if not draft:
            raise ValueError("Interaction not found")
        draft.status = InteractionStatus.rejected
        db.commit()
        db.refresh(draft)
        return draft

    def list_drafts(self, db: Session) -> list[Interaction]:
        return (
            db.query(Interaction)
            .filter(Interaction.status == InteractionStatus.draft)
            .order_by(Interaction.created_at.desc())
            .all()
        )

    def generate_draft_from_template(
        self,
        db: Session,
        *,
        buyer_id: int,
        template_id: int,
    ) -> Interaction:
        from modules import buyers as buyers_module
        from modules.email_templates import get_template, render_template_text

        buyer = db.get(Buyer, buyer_id)
        if not buyer:
            raise ValueError(f"Buyer {buyer_id} not found")

        template = get_template(db, template_id)
        if not template:
            raise ValueError("Email template not found")

        contact = buyers_module.primary_contact_with_email(db, buyer_id)
        if not contact:
            raise ValueError(f"No contact with email for {buyer.company_name}")

        subject = render_template_text(template.subject, buyer=buyer, contact=contact)
        body = render_template_text(template.body, buyer=buyer, contact=contact)

        draft = Interaction(
            contact_id=contact.id,
            channel=Channel.email,
            direction=Direction.outbound,
            subject=subject,
            content=body,
            language=contact.preferred_language or "en",
            handled_by=HandledBy.agent,
            status=InteractionStatus.draft,
        )
        db.add(draft)
        db.commit()
        db.refresh(draft)
        return draft

    def create_bulk_drafts_from_template(
        self,
        db: Session,
        *,
        buyer_ids: list[int],
        template_id: int,
    ) -> dict:
        created: list[dict] = []
        skipped: list[dict] = []

        for buyer_id in buyer_ids:
            buyer = db.get(Buyer, buyer_id)
            if not buyer:
                skipped.append({"buyer_id": buyer_id, "reason": "lead not found"})
                continue
            try:
                draft = self.generate_draft_from_template(
                    db,
                    buyer_id=buyer_id,
                    template_id=template_id,
                )
                created.append(
                    {
                        "buyer_id": buyer_id,
                        "company_name": buyer.company_name,
                        "interaction_id": draft.id,
                        "contact_id": draft.contact_id,
                    }
                )
            except ValueError as exc:
                skipped.append(
                    {
                        "buyer_id": buyer_id,
                        "company_name": buyer.company_name,
                        "reason": str(exc),
                    }
                )

        return {
            "created_count": len(created),
            "skipped_count": len(skipped),
            "created": created,
            "skipped": skipped,
        }

    def bulk_approve_drafts(
        self,
        db: Session,
        interaction_ids: list[int],
        *,
        approved_by: str = "sales_rep",
        send: bool = True,
        message_delay_seconds: float | None = None,
    ) -> dict:
        import time

        from config import settings

        delay = (
            message_delay_seconds
            if message_delay_seconds is not None
            else settings.bulk_email_message_delay_seconds
        )

        results: list[dict] = []
        sent_count = 0
        failed_count = 0

        for index, interaction_id in enumerate(interaction_ids):
            if index > 0 and send and delay > 0:
                time.sleep(delay)
            try:
                draft, send_result = self.approve_draft(
                    db,
                    interaction_id,
                    approved_by=approved_by,
                    send=send,
                )
                sent = draft.status == InteractionStatus.sent
                if sent:
                    sent_count += 1
                elif send:
                    failed_count += 1
                results.append(
                    {
                        "interaction_id": interaction_id,
                        "status": draft.status.value,
                        "sent": sent,
                        "send_status": (send_result or {}).get("status"),
                        "send_message": (send_result or {}).get("message"),
                    }
                )
            except ValueError as exc:
                failed_count += 1
                results.append(
                    {
                        "interaction_id": interaction_id,
                        "status": "error",
                        "sent": False,
                        "send_message": str(exc),
                    }
                )

        return {
            "processed": len(results),
            "sent_count": sent_count,
            "failed_count": failed_count,
            "results": results,
        }

    def interaction_to_dict(self, db: Session, interaction: Interaction) -> dict:
        contact = db.get(Contact, interaction.contact_id)
        buyer = db.get(Buyer, contact.buyer_id) if contact else None
        return {
            "id": interaction.id,
            "contact_id": interaction.contact_id,
            "channel": interaction.channel.value,
            "direction": interaction.direction.value,
            "subject": interaction.subject,
            "content": interaction.content,
            "status": interaction.status.value,
            "created_at": interaction.created_at,
            "company_name": buyer.company_name if buyer else None,
            "contact_name": contact.full_name if contact else None,
            "contact_email": contact.email if contact else None,
        }

    def list_interactions(self, db: Session, limit: int = 100) -> list[Interaction]:
        return (
            db.query(Interaction)
            .order_by(Interaction.created_at.desc())
            .limit(limit)
            .all()
        )


_comms = CommsGenerator()


def get_comms() -> CommsGenerator:
    return _comms
