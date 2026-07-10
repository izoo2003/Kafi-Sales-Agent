import { useCallback, useEffect, useRef, useState } from "react";
import {
  client,
  type InboxMessageDetail,
  type InboxMessageSummary,
  type InboxStatus,
} from "../api/client";
import { alertNewInboxMessage, unlockNotificationAudio } from "../utils/notify";

interface InboxPageProps {
  onError: (message: string) => void;
  onUnreadChange?: (count: number) => void;
}

function formatDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function senderLabel(msg: InboxMessageSummary): string {
  return msg.from_name || msg.from_email || "Unknown sender";
}

function initials(msg: InboxMessageSummary): string {
  const source = msg.from_name || msg.from_email || "?";
  return source.trim().charAt(0).toUpperCase();
}

export function InboxPage({ onError, onUnreadChange }: InboxPageProps) {
  const [status, setStatus] = useState<InboxStatus | null>(null);
  const [messages, setMessages] = useState<InboxMessageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [detail, setDetail] = useState<InboxMessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const [replyBody, setReplyBody] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const bodyIframeRef = useRef<HTMLIFrameElement | null>(null);
  const pollTimerRef = useRef<number | null>(null);

  const loadMessages = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setLoading(true);
    try {
      const s = await client.getInboxStatus();
      setStatus(s);
      onUnreadChange?.(s.unread_count);
      if (!s.configured) {
        setMessages([]);
        return;
      }
      const rows = await client.listInboxMessages({ limit: 50, unread_only: unreadOnly });
      setMessages(rows);
    } catch (e) {
      if (!options?.silent) {
        onError(e instanceof Error ? e.message : "Failed to load inbox");
      }
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }, [onError, onUnreadChange, unreadOnly]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!status?.configured) return;
    pollTimerRef.current = window.setInterval(() => {
      void loadMessages({ silent: true });
    }, 12_000);
    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current);
      }
    };
  }, [status?.configured, loadMessages]);

  const openMessage = useCallback(
    async (uid: string) => {
      setSelectedUid(uid);
      setDetail(null);
      setDetailLoading(true);
      setNotice(null);
      setReplyBody("");
      try {
        const message = await client.getInboxMessage(uid);
        setDetail(message);
        setReplyTo(message.from_email ?? "");
        if (message.unread) {
          try {
            const { count } = await client.markInboxMessageRead(uid);
            onUnreadChange?.(count);
            setMessages((prev) =>
              prev.map((m) => (m.uid === uid ? { ...m, unread: false } : m)),
            );
          } catch {
            /* non-fatal: read flag update failed */
          }
        }
      } catch (e) {
        onError(e instanceof Error ? e.message : "Failed to open message");
      } finally {
        setDetailLoading(false);
      }
    },
    [onError, onUnreadChange],
  );

  useEffect(() => {
    const iframe = bodyIframeRef.current;
    if (iframe && detail?.body_html) {
      iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;color:#0f172a;background:#fff;margin:12px;font-size:14px;line-height:1.5;} img{max-width:100%;height:auto;} a{color:#0369a1;}</style></head><body>${detail.body_html}</body></html>`;
    }
  }, [detail]);

  async function sendReply() {
    if (!selectedUid || !replyBody.trim()) return;
    setSending(true);
    setNotice(null);
    try {
      const result = await client.replyInboxMessage(selectedUid, {
        body: replyBody,
        to: replyTo.trim() || undefined,
      });
      setNotice(`Reply sent to ${result.to ?? replyTo}.`);
      setReplyBody("");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  async function resetCutoff() {
    try {
      const { showing_since } = await client.resetInboxCutoff();
      setNotice(`Only showing mail received after ${new Date(showing_since).toLocaleString()}.`);
      setSelectedUid(null);
      setDetail(null);
      await loadMessages();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to reset inbox cutoff");
    }
  }

  function formatSince(value: string | null | undefined): string {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
  }

  if (!loading && status && !status.configured) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-slate-100">Inbox</h2>
        <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/40 text-slate-400 text-sm">
          <p>Inbox is not enabled yet.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-medium text-slate-100">Inbox</h2>
          <p className="text-sm text-slate-500 mt-1">
            {status?.email ? `Outlook: ${status.email}` : "Received messages"}
            {status ? ` · ${status.unread_count} unread` : ""}
          </p>
          {status?.showing_since && (
            <p className="text-xs text-slate-500 mt-1">
              Showing mail from {formatSince(status.showing_since)} onward (older messages hidden).
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void resetCutoff()}
            className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-sm"
            title="Hide all mail before right now"
          >
            New mail only
          </button>
          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input
              type="checkbox"
              checked={unreadOnly}
              onChange={(e) => setUnreadOnly(e.target.checked)}
              className="accent-emerald-600"
            />
            Unread only
          </label>
          <button
            type="button"
            onClick={() => void loadMessages()}
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              unlockNotificationAudio();
              alertNewInboxMessage({ from: "Test sender", subject: "Test alert" });
            }}
            className="px-3 py-2 rounded-lg bg-amber-900/40 hover:bg-amber-900/60 border border-amber-700/50 text-amber-100 text-sm"
            title="Click once to enable sound, then test the alert"
          >
            Test alert
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,380px)_1fr] gap-4">
        <div className="rounded-xl border border-slate-800 overflow-hidden">
          <div className="max-h-[70vh] overflow-y-auto divide-y divide-slate-800/80">
            {loading ? (
              <p className="py-10 text-center text-slate-500 text-sm">Loading messages…</p>
            ) : messages.length === 0 ? (
              <p className="py-10 text-center text-slate-500 text-sm">No messages.</p>
            ) : (
              messages.map((msg) => {
                const active = msg.uid === selectedUid;
                return (
                  <button
                    key={msg.uid}
                    type="button"
                    onClick={() => void openMessage(msg.uid)}
                    className={`w-full text-left px-4 py-3 transition ${
                      active ? "bg-emerald-600/15" : "hover:bg-slate-900/60"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 shrink-0 w-8 h-8 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-sm font-medium">
                        {initials(msg)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {msg.unread && (
                            <span className="shrink-0 w-2 h-2 rounded-full bg-emerald-400" />
                          )}
                          <span
                            className={`truncate text-sm ${
                              msg.unread ? "text-slate-100 font-semibold" : "text-slate-300"
                            }`}
                          >
                            {senderLabel(msg)}
                          </span>
                          <span className="ml-auto shrink-0 text-[11px] text-slate-500">
                            {formatDate(msg.date)}
                          </span>
                        </div>
                        <div
                          className={`truncate text-sm ${
                            msg.unread ? "text-slate-200" : "text-slate-400"
                          }`}
                        >
                          {msg.subject}
                        </div>
                        <div className="truncate text-xs text-slate-500">{msg.preview}</div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 min-h-[50vh] flex flex-col">
          {!selectedUid ? (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Select a message to read it.
            </div>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Loading…
            </div>
          ) : detail ? (
            <div className="flex flex-col h-full">
              <div className="px-5 py-4 border-b border-slate-800">
                <h3 className="text-base font-semibold text-slate-100">{detail.subject}</h3>
                <p className="mt-1 text-sm text-slate-400">
                  <span className="text-slate-300">{senderLabel(detail)}</span>
                  {detail.from_email && detail.from_name ? (
                    <span className="text-slate-500"> &lt;{detail.from_email}&gt;</span>
                  ) : null}
                </p>
                <p className="text-xs text-slate-500">{formatDate(detail.date)}</p>
                {detail.attachments.length > 0 && (
                  <p className="mt-2 text-xs text-slate-400">
                    {detail.attachments.length} attachment(s):{" "}
                    {detail.attachments.map((a) => a.filename).filter(Boolean).join(", ")}
                  </p>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                {detail.body_html ? (
                  <iframe
                    ref={bodyIframeRef}
                    title="Message body"
                    sandbox=""
                    className="w-full min-h-[280px] bg-white"
                  />
                ) : (
                  <pre className="px-5 py-4 whitespace-pre-wrap break-words text-sm text-slate-200 font-sans">
                    {detail.body_text || "(empty message)"}
                  </pre>
                )}
              </div>

              <div className="px-5 py-4 border-t border-slate-800 space-y-2">
                {notice && (
                  <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm">
                    {notice}
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-slate-500">To</span>
                  <input
                    type="text"
                    value={replyTo}
                    onChange={(e) => setReplyTo(e.target.value)}
                    className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm"
                  />
                </div>
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Write a reply…"
                  rows={4}
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm resize-y"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => void sendReply()}
                    disabled={sending || !replyBody.trim()}
                    className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50"
                  >
                    {sending ? "Sending…" : "Send reply"}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Message not found.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
