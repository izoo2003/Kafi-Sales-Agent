import { useCallback, useEffect, useState } from "react";
import {
  client,
  type PersonalizedFollowupDraft,
  type PersonalizedFollowupListResponse,
} from "../api/client";
import { ActionButton } from "../components/ui/ActionButton";
import {
  IconRefresh,
  IconSave,
  IconSend,
  IconSparkles,
  IconX,
} from "../components/icons/AppIcons";
import { deriveWhatsAppFromEmail } from "../utils/channelSync";

interface PersonalizedEmailsPageProps {
  onError: (message: string) => void;
  onCountChange?: (count: number) => void;
  /** When true, omit the top page title (used inside AI Mode tabs). */
  embedded?: boolean;
}

const STATUS_LABELS: Record<string, string> = {
  awaiting_transcript: "Waiting for captions",
  generating: "Generating…",
  ready: "Ready to send",
  failed: "Failed",
  sent: "Sent",
  dismissed: "Dismissed",
};

const OUTCOME_LABELS: Record<string, string> = {
  interested: "Interested",
  follow_up: "Follow up",
};

function statusClass(status: string): string {
  if (status === "ready") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (status === "generating" || status === "awaiting_transcript") {
    return "bg-amber-500/15 text-amber-200 border-amber-500/30";
  }
  if (status === "failed") return "bg-rose-500/15 text-rose-200 border-rose-500/30";
  if (status === "sent") return "bg-slate-700/60 text-slate-300 border-slate-600";
  return "bg-slate-800 text-slate-400 border-slate-700";
}

export function PersonalizedEmailsPage({
  onError,
  onCountChange,
  embedded = false,
}: PersonalizedEmailsPageProps) {
  const [rows, setRows] = useState<PersonalizedFollowupDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<"active" | "ready" | "sent">("active");

  const selected = rows.find((r) => r.id === selectedId) ?? null;

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const status = filter === "active" ? undefined : filter;
      const data: PersonalizedFollowupListResponse = await client.listPersonalizedFollowups(
        status ? { status } : {},
      );
      setRows(data.rows);
      onCountChange?.(data.pending_count);
      setSelectedId((prev) => {
        if (prev && data.rows.some((r) => r.id === prev)) return prev;
        return data.rows[0]?.id ?? null;
      });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load personalized emails");
    } finally {
      setLoading(false);
    }
  }, [filter, onCountChange, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selected) {
      setSubject("");
      setEmailBody("");
      return;
    }
    setSubject(selected.subject || "");
    setEmailBody(selected.email_body || "");
  }, [selected]);

  // WhatsApp always mirrors email — same information on both channels.
  const whatsappBody = deriveWhatsAppFromEmail(emailBody);

  // Poll while any draft is generating / waiting for captions
  useEffect(() => {
    const pending = rows.some((r) =>
      ["awaiting_transcript", "generating"].includes(r.status),
    );
    if (!pending) return;
    const id = window.setInterval(() => {
      void refresh();
    }, 8000);
    return () => window.clearInterval(id);
  }, [rows, refresh]);

  async function handleSave() {
    if (!selected) return;
    setSaving(true);
    setNotice(null);
    try {
      const updated = await client.updatePersonalizedFollowup(selected.id, {
        subject,
        email_body: emailBody,
      });
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setEmailBody(updated.email_body || emailBody);
      setNotice("Draft saved. Email and WhatsApp stay synchronized.");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save draft");
    } finally {
      setSaving(false);
    }
  }

  async function handleRegenerate(id: number) {
    setBusyId(id);
    setNotice(null);
    try {
      const updated = await client.regeneratePersonalizedFollowup(id);
      setRows((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      setNotice("Regenerating from closed captions…");
      window.setTimeout(() => void refresh(), 2500);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to regenerate");
    } finally {
      setBusyId(null);
    }
  }

  async function handleSend() {
    if (!selected) return;
    if (!window.confirm("Send this message via email and WhatsApp?")) return;
    setSending(true);
    setNotice(null);
    try {
      await client.updatePersonalizedFollowup(selected.id, {
        subject,
        email_body: emailBody,
      });
      const result = await client.sendPersonalizedFollowup(selected.id);
      setNotice(result.message);
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  async function handleDismiss(id: number) {
    if (!window.confirm("Dismiss this personalized draft?")) return;
    setBusyId(id);
    try {
      await client.dismissPersonalizedFollowup(id);
      setNotice("Draft dismissed.");
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to dismiss");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className={`w-full min-w-0 ${embedded ? "space-y-4" : "space-y-6"}`}>
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          {!embedded ? (
            <h2 className="text-lg font-medium text-slate-100">Personalized Emails</h2>
          ) : null}
          <p className={`text-sm text-slate-400 max-w-2xl ${embedded ? "" : "mt-1"}`}>
            After a call is marked Interested or Follow up, a draft is built from closed
            captions. Review once — the same message is sent on email and WhatsApp.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value as "active" | "ready" | "sent");
              setSelectedId(null);
            }}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200"
          >
            <option value="active">Active drafts</option>
            <option value="ready">Ready only</option>
            <option value="sent">Sent</option>
          </select>
          <ActionButton
            icon={IconRefresh}
            size="md"
            onClick={() => void refresh()}
            title="Refresh"
          >
            Refresh
          </ActionButton>
        </div>
      </div>

      {notice && (
        <p className="text-sm text-emerald-300/90 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
          {notice}
        </p>
      )}

      {loading && !rows.length ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : !rows.length ? (
        <div className="rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-10 text-center">
          <p className="text-slate-300">No personalized drafts yet</p>
          <p className="mt-2 text-sm text-slate-500 max-w-md mx-auto">
            Mark a completed call as Interested or Follow up. When captions (or remarks)
            are available, a draft appears here for your review.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <ul className="space-y-1 rounded-xl border border-slate-800 bg-slate-900/40 p-2 max-h-[70vh] overflow-y-auto">
            {rows.map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(row.id)}
                  className={`w-full text-left rounded-lg px-3 py-2.5 transition ${
                    selectedId === row.id
                      ? "bg-emerald-600/20 border border-emerald-500/40"
                      : "hover:bg-slate-800/80 border border-transparent"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-slate-100 truncate">
                      {row.company_name || `Buyer #${row.buyer_id}`}
                    </span>
                    <span
                      className={`shrink-0 text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${statusClass(row.status)}`}
                    >
                      {STATUS_LABELS[row.status] || row.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500 truncate">
                    {OUTCOME_LABELS[row.call_outcome] || row.call_outcome}
                    {row.contact_name ? ` · ${row.contact_name}` : ""}
                  </p>
                </button>
              </li>
            ))}
          </ul>

          {selected ? (
            <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:p-5 space-y-4 min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-medium text-slate-100">
                    {selected.company_name || `Buyer #${selected.buyer_id}`}
                  </h3>
                  <p className="mt-1 text-xs text-slate-500">
                    {selected.contact_name || "Contact"}
                    {selected.contact_email ? ` · ${selected.contact_email}` : " · no email"}
                    {selected.contact_phone ? ` · ${selected.contact_phone}` : " · no WhatsApp phone"}
                    {selected.country ? ` · ${selected.country}` : ""}
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded border ${statusClass(selected.status)}`}
                >
                  {STATUS_LABELS[selected.status] || selected.status}
                </span>
              </div>

              {selected.generation_error && selected.status !== "ready" && (
                <p className="text-xs text-amber-200/90">{selected.generation_error}</p>
              )}

              {selected.transcript_excerpt && (
                <details className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
                  <summary className="cursor-pointer text-xs text-slate-400">
                    Conversation excerpt (captions / remarks)
                  </summary>
                  <p className="mt-2 text-xs text-slate-400 whitespace-pre-wrap max-h-40 overflow-y-auto">
                    {selected.transcript_excerpt}
                  </p>
                </details>
              )}

              <label className="block space-y-1.5">
                <span className="text-xs text-slate-400">Email subject</span>
                <input
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  disabled={selected.status === "sent"}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-60"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="text-xs text-slate-400">
                  Message (email + WhatsApp — same information)
                </span>
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  disabled={selected.status === "sent"}
                  rows={10}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 disabled:opacity-60 resize-y min-h-[10rem]"
                />
              </label>

              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 space-y-1.5">
                <p className="text-xs text-emerald-300/90">
                  WhatsApp preview (locked to the message above — both channels stay in sync)
                </p>
                <pre className="whitespace-pre-wrap break-words text-sm text-slate-300 font-sans m-0 max-h-36 overflow-y-auto">
                  {whatsappBody || "—"}
                </pre>
              </div>

              {(selected.email_send_status || selected.whatsapp_send_status) && (
                <div className="text-xs text-slate-400 space-y-1">
                  {selected.email_send_status && (
                    <p>
                      Email: {selected.email_send_status}
                      {selected.email_send_message ? ` — ${selected.email_send_message}` : ""}
                    </p>
                  )}
                  {selected.whatsapp_send_status && (
                    <p>
                      WhatsApp: {selected.whatsapp_send_status}
                      {selected.whatsapp_send_message
                        ? ` — ${selected.whatsapp_send_message}`
                        : ""}
                    </p>
                  )}
                </div>
              )}

              {selected.status !== "sent" && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <ActionButton
                    icon={IconSave}
                    size="md"
                    onClick={() => void handleSave()}
                    disabled={saving}
                    title="Save edits"
                  >
                    {saving ? "Saving…" : "Save"}
                  </ActionButton>
                  <ActionButton
                    icon={IconSparkles}
                    size="md"
                    onClick={() => void handleRegenerate(selected.id)}
                    disabled={busyId === selected.id}
                    title="Regenerate from captions"
                  >
                    Regenerate
                  </ActionButton>
                  <ActionButton
                    icon={IconSend}
                    variant="primary"
                    size="md"
                    onClick={() => void handleSend()}
                    disabled={
                      sending ||
                      !subject.trim() ||
                      !emailBody.trim() ||
                      selected.status === "generating"
                    }
                    title="Send email and WhatsApp"
                  >
                    {sending ? "Sending…" : "Send email + WhatsApp"}
                  </ActionButton>
                  <ActionButton
                    icon={IconX}
                    variant="rose"
                    size="md"
                    onClick={() => void handleDismiss(selected.id)}
                    disabled={busyId === selected.id}
                    title="Dismiss"
                  >
                    Dismiss
                  </ActionButton>
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-slate-500 p-4">Select a draft to review.</p>
          )}
        </div>
      )}
    </section>
  );
}
