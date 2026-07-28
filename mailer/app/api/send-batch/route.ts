import { NextRequest, NextResponse } from "next/server";
import { verifyHandoff } from "@/lib/handoff";
import { sendSmtp, sleep } from "@/lib/smtp";

export const runtime = "nodejs";
export const maxDuration = 60;

type Lead = {
  buyer_id: number;
  company_name: string;
  contact_name?: string | null;
  contact_email: string;
};

function renderTemplate(
  template: string,
  lead: Lead,
): string {
  return template
    .replaceAll("{{company_name}}", lead.company_name || "")
    .replaceAll("{{contact_name}}", lead.contact_name || lead.company_name || "")
    .replaceAll("{{contact_email}}", lead.contact_email || "");
}

export async function POST(req: NextRequest) {
  const secret = process.env.MAILER_HANDOFF_SECRET || "";
  if (!secret) {
    return NextResponse.json(
      { error: "MAILER_HANDOFF_SECRET not configured on mailer" },
      { status: 500 },
    );
  }

  let body: {
    token?: string;
    subject?: string;
    body?: string;
    leads?: Lead[];
    message_delay_seconds?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const token = (body.token || "").trim();
  if (!token) {
    return NextResponse.json({ error: "token required" }, { status: 400 });
  }

  let handoff;
  try {
    handoff = await verifyHandoff(token, secret);
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  const subjectTpl = (body.subject || "").trim();
  const bodyTpl = (body.body || "").trim();
  if (!subjectTpl || !bodyTpl) {
    return NextResponse.json({ error: "subject and body required" }, { status: 400 });
  }

  const leads = (body.leads?.length ? body.leads : handoff.leads || []).filter(
    (l) => l.contact_email && l.contact_email.includes("@"),
  );
  if (!leads.length) {
    return NextResponse.json({ error: "No leads with email in this batch" }, { status: 400 });
  }
  if (leads.length > 15) {
    return NextResponse.json(
      { error: "Max 15 emails per batch request (raise batch size carefully)" },
      { status: 400 },
    );
  }

  const delayMs = Math.max(
    0,
    Math.round((body.message_delay_seconds ?? 2) * 1000),
  );

  const results: Array<{
    buyer_id: number;
    email: string;
    ok: boolean;
    message: string;
  }> = [];

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const subject = renderTemplate(subjectTpl, lead);
    const text = renderTemplate(bodyTpl, lead);
    const sent = await sendSmtp({
      username: handoff.username,
      mailboxEmail: handoff.mailbox_email,
      to: lead.contact_email,
      subject,
      body: text,
      html: true,
    });
    results.push({
      buyer_id: lead.buyer_id,
      email: lead.contact_email,
      ok: sent.ok,
      message: sent.message,
    });
    if (i < leads.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }

  const sent = results.filter((r) => r.ok).length;
  const failed = results.length - sent;
  return NextResponse.json({ sent, failed, results });
}
