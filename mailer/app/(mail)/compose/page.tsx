"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, getStoredToken } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";
import { TemplatePicker } from "@/components/TemplatePicker";

function ComposeInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { token, user } = useAuth();
  const [to, setTo] = useState(params.get("to") || "");
  const [subject, setSubject] = useState(params.get("subject") || "");
  const [body, setBody] = useState(params.get("body") || "");
  const [templateId, setTemplateId] = useState("");
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const draftId = params.get("draft_id");

  async function saveDraft() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/inbox/drafts", {
        method: "POST",
        body: JSON.stringify({
          id: draftId ? Number(draftId) : undefined,
          to_addrs: to,
          subject,
          body,
        }),
      });
      setNotice("Draft saved");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function send() {
    const auth = token || getStoredToken();
    if (!auth) {
      setError("Not signed in");
      return;
    }
    if (!to.includes("@") || !subject.trim() || !body.trim()) {
      setError("To, subject, and body are required");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth_token: auth,
          to: to.trim(),
          subject: subject.trim(),
          body,
          html: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      if (draftId) {
        void apiFetch(`/inbox/drafts/${draftId}`, { method: "DELETE" }).catch(() => null);
      }
      setNotice("Sent via Vercel SMTP");
      window.setTimeout(() => router.push("/sent"), 800);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="pad compose-page">
      <h2 className="folder-title">Compose</h2>
      <p className="muted small">
        From: {user?.mailbox_email || user?.username} · Sends via Vercel SMTP (not Railway)
      </p>
      {error && <p className="bad">{error}</p>}
      {notice && <p className="ok">{notice}</p>}

      <TemplatePicker
        value={templateId}
        onChange={(id, tpl) => {
          setTemplateId(id);
          if (tpl) {
            setSubject(tpl.subject);
            setBody(tpl.body);
            setNotice(`Loaded template “${tpl.name}” — edit before send if needed`);
          }
        }}
      />

      <label>To</label>
      <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" />
      <label>Subject</label>
      <input value={subject} onChange={(e) => setSubject(e.target.value)} />
      <label>Body</label>
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} />
      <div className="detail-actions">
        <button type="button" className="btn" disabled={sending} onClick={() => void send()}>
          {sending ? "Sending…" : "Send"}
        </button>
        <button type="button" className="btn ghost" disabled={saving} onClick={() => void saveDraft()}>
          {saving ? "Saving…" : "Save draft"}
        </button>
      </div>
    </div>
  );
}

export default function ComposePage() {
  return (
    <Suspense fallback={<div className="pad muted">Loading…</div>}>
      <ComposeInner />
    </Suspense>
  );
}
