import { NextRequest, NextResponse } from "next/server";
import { verifyHandoff } from "@/lib/handoff";
import { sendSmtp } from "@/lib/smtp";

export const runtime = "nodejs";
export const maxDuration = 60;

function apiBase(): string {
  return (
    process.env.KAFI_API_BASE_URL ||
    process.env.NEXT_PUBLIC_KAFI_API_BASE_URL ||
    ""
  )
    .trim()
    .replace(/\/$/, "");
}

async function resolveUsernameFromSession(
  authToken: string,
): Promise<{ username: string; mailbox_email?: string | null } | null> {
  const base = apiBase();
  if (!base) return null;
  try {
    const res = await fetch(`${base}/auth/me`, {
      headers: { Authorization: `Bearer ${authToken}` },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const user = (await res.json()) as {
      username?: string;
      mailbox_email?: string | null;
    };
    if (!user.username) return null;
    return { username: user.username, mailbox_email: user.mailbox_email };
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
  let body: {
    token?: string;
    auth_token?: string;
    to?: string;
    subject?: string;
    body?: string;
    html?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const to = (body.to || "").trim();
  const subject = (body.subject || "").trim();
  const text = (body.body || "").trim();
  if (!to.includes("@") || !subject || !text) {
    return NextResponse.json(
      { error: "to, subject, and body are required" },
      { status: 400 },
    );
  }

  let username = "";
  let mailboxEmail: string | undefined;

  const handoffToken = (body.token || "").trim();
  const authToken = (body.auth_token || "").trim();

  if (handoffToken) {
    const secret = process.env.MAILER_HANDOFF_SECRET || "";
    if (!secret) {
      return NextResponse.json(
        { error: "MAILER_HANDOFF_SECRET not configured" },
        { status: 500 },
      );
    }
    try {
      const handoff = await verifyHandoff(handoffToken, secret);
      username = handoff.username;
      mailboxEmail = handoff.mailbox_email;
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
  } else if (authToken) {
    const user = await resolveUsernameFromSession(authToken);
    if (!user) {
      return NextResponse.json({ error: "Invalid session" }, { status: 401 });
    }
    username = user.username;
    mailboxEmail = user.mailbox_email || undefined;
  } else {
    return NextResponse.json(
      { error: "auth_token or token required" },
      { status: 401 },
    );
  }

  const sent = await sendSmtp({
    username,
    mailboxEmail,
    to,
    subject,
    body: text,
    html: body.html !== false,
  });

  if (!sent.ok) {
    return NextResponse.json({ ok: false, error: sent.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true, message: sent.message });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: `Send failed: ${message}` },
      { status: 500 },
    );
  }
}
