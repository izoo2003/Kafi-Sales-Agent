import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  client,
  type InboxMessageDetail,
  type InboxStatus,
  type InboxThreadDetail,
  type InboxThreadSummary,
} from "../api/client";
import { alertNewInboxMessage, unlockNotificationAudio } from "../utils/notify";

interface InboxPageProps {
  onError: (message: string) => void;
  onUnreadChange?: (count: number) => void;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function replySubject(original: string | null | undefined): string {
  const subject = (original || "").trim();
  if (!subject) return "Re:";
  if (subject.toLowerCase().startsWith("re:")) return subject;
  return `Re: ${subject}`;
}

function senderLabel(fromName: string | null | undefined, fromEmail: string | null | undefined): string {
  return fromName || fromEmail || "Unknown";
}

function initialsFrom(label: string): string {
  return label.trim().charAt(0).toUpperCase() || "?";
}

function participantsLabel(thread: InboxThreadSummary, mailboxEmail?: string | null): string {
  const mailbox = (mailboxEmail || "").toLowerCase();
  const others = thread.participants.filter((p) => p.toLowerCase() !== mailbox);
  if (others.length) return others.join(", ");
  return thread.latest_from_name || thread.latest_from_email || "Conversation";
}

function buildQuotedReply(message: InboxMessageDetail): string {
  const when = formatDate(message.date) || "earlier";
  const who = senderLabel(message.from_name, message.from_email);
  const raw =
    (message.body_text || "").trim() ||
    (message.body_html ? stripHtml(message.body_html) : "") ||
    (message.preview || "").trim();
  const lines = raw ? raw.split(/\r?\n/) : [""];
  const quoted = lines.map((line) => (line ? `> ${line}` : ">")).join("\n");
  return `\n\nOn ${when}, ${who} wrote:\n${quoted}`;
}

function MessageBody({ message }: { message: InboxMessageDetail }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(220);
  const html = message.body_html?.trim();
  const text = message.body_text?.trim();

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !html) return;
    iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>
      html,body{margin:0;padding:0;background:#fff;}
      body{font-family:Segoe UI,system-ui,sans-serif;color:#0f172a;padding:10px;font-size:14px;line-height:1.55;word-break:break-word;}
      img,video{max-width:100%;height:auto;}
      a{color:#0369a1;}
      pre,code{white-space:pre-wrap;word-break:break-word;}
    </style></head><body>${html}</body></html>`;
  }, [html, message.uid, message.folder]);

  if (html) {
    return (
      <iframe
        ref={iframeRef}
        title={`Message ${message.uid}`}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        onLoad={() => {
          try {
            const doc = iframeRef.current?.contentDocument;
            const next = doc?.documentElement?.scrollHeight || doc?.body?.scrollHeight || 0;
            if (next > 0) setHeight(Math.min(Math.max(next + 8, 120), 900));
          } catch {
            setHeight(280);
          }
        }}
        style={{ height }}
        className="w-full border-0 rounded-lg bg-white"
      />
    );
  }

  return (
    <pre className="whitespace-pre-wrap break-words text-sm text-slate-200 font-sans m-0">
      {text || message.preview || "(empty message)"}
    </pre>
  );
}

export function InboxPage({ onError, onUnreadChange }: InboxPageProps) {
  const [status, setStatus] = useState<InboxStatus | null>(null);
  const [threads, setThreads] = useState<InboxThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [thread, setThread] = useState<InboxThreadDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const [replyBody, setReplyBody] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [replyCc, setReplyCc] = useState("");
  const [replySubjectLine, setReplySubjectLine] = useState("");
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const pollTimerRef = useRef<number | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);

  const loadThreads = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setLoading(true);
      try {
        const s = await client.getInboxStatus();
        setStatus(s);
        onUnreadChange?.(s.unread_count);
        if (!s.configured) {
          setThreads([]);
          return;
        }
        const rows = await client.listInboxThreads({ limit: 60, unread_only: unreadOnly });
        setThreads(rows);
      } catch (e) {
        if (!options?.silent) {
          onError(e instanceof Error ? e.message : "Failed to load inbox");
        }
      } finally {
        if (!options?.silent) setLoading(false);
      }
    },
    [onError, onUnreadChange, unreadOnly],
  );

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    if (!status?.configured) return;
    pollTimerRef.current = window.setInterval(() => {
      void loadThreads({ silent: true });
    }, 15_000);
    return () => {
      if (pollTimerRef.current !== null) window.clearInterval(pollTimerRef.current);
    };
  }, [status?.configured, loadThreads]);

  const openThread = useCallback(
    async (threadId: string) => {
      setSelectedThreadId(threadId);
      setThread(null);
      setDetailLoading(true);
      setNotice(null);
      setShowReplyForm(false);
      setReplyBody("");
      setReplyCc("");
      try {
        const detail = await client.getInboxThread(threadId);
        setThread(detail);
        setReplySubjectLine(replySubject(detail.subject));

        const latestInbound = [...detail.messages]
          .reverse()
          .find((m) => m.direction !== "outbound");
        const latest = latestInbound || detail.messages[detail.messages.length - 1];
        if (latest?.direction === "outbound") {
          setReplyTo((latest.to && latest.to[0]) || "");
        } else {
          setReplyTo(latest?.from_email || "");
        }

        setThreads((prev) =>
          prev.map((t) => (t.thread_id === threadId ? { ...t, unread_count: 0 } : t)),
        );
        const s = await client.getInboxStatus();
        onUnreadChange?.(s.unread_count);
        setStatus(s);
      } catch (e) {
        onError(e instanceof Error ? e.message : "Failed to open conversation");
      } finally {
        setDetailLoading(false);
      }
    },
    [onError, onUnreadChange],
  );

  useEffect(() => {
    if (!thread || detailLoading) return;
    conversationEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [thread, detailLoading]);

  const replyTarget = useMemo(() => {
    if (!thread?.messages.length) return null;
    return (
      [...thread.messages].reverse().find((m) => m.direction !== "outbound") ||
      thread.messages[thread.messages.length - 1]
    );
  }, [thread]);

  function startReply() {
    if (!thread || !replyTarget) return;
    setShowReplyForm(true);
    setNotice(null);
    if (!replyBody.trim()) {
      setReplyBody(buildQuotedReply(replyTarget));
    }
  }

  async function sendReply() {
    if (!selectedThreadId || !replyBody.trim()) return;
    setSending(true);
    setNotice(null);
    try {
      const result = await client.replyInboxThread(selectedThreadId, {
        body: replyBody,
        to: replyTo.trim() || undefined,
        subject: replySubjectLine.trim() || undefined,
        cc: replyCc.trim() || undefined,
      });
      setNotice(`Reply sent to ${result.to ?? replyTo}.`);
      setReplyBody("");
      setShowReplyForm(false);
      await openThread(selectedThreadId);
      await loadThreads({ silent: true });
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
      setSelectedThreadId(null);
      setThread(null);
      await loadThreads();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to reset inbox cutoff");
    }
  }

  async function showAllMail() {
    try {
      await client.clearInboxCutoff();
      setNotice("Showing all mailbox conversations.");
      setSelectedThreadId(null);
      setThread(null);
      setUnreadOnly(false);
      await loadThreads();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to show all mail");
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
        <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/40 text-slate-400 text-sm space-y-2">
          <p>Inbox is not enabled yet.</p>
          <p>
            Set <code className="text-slate-300">MAILBOX_ENABLED=true</code> and Outlook OAuth
            tokens in <code className="text-slate-300">backend/.env</code>, then restart the
            backend.
          </p>
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
            {status?.email ? `Outlook: ${status.email}` : "Conversations"}
            {status ? ` · ${status.unread_count} unread` : ""}
          </p>
          {status?.showing_since && (
            <p className="text-xs text-slate-500 mt-1">
              Temporary filter: mail from {formatSince(status.showing_since)} onward.{" "}
              <button
                type="button"
                onClick={() => void showAllMail()}
                className="text-emerald-400 hover:text-emerald-300 underline"
              >
                Show all mail
              </button>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void resetCutoff()}
            className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-sm"
            title="Hide mail received before right now"
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
            onClick={() => void loadThreads()}
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
          >
            Test alert
          </button>
        </div>
      </div>

      {notice && !showReplyForm && (
        <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(280px,380px)_1fr] gap-4">
        <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-950/40">
          <div className="max-h-[75vh] overflow-y-auto divide-y divide-slate-800/80">
            {loading ? (
              <p className="py-10 text-center text-slate-500 text-sm">Loading conversations…</p>
            ) : threads.length === 0 ? (
              <p className="py-10 text-center text-slate-500 text-sm">No conversations.</p>
            ) : (
              threads.map((item) => {
                const active = item.thread_id === selectedThreadId;
                const label = participantsLabel(item, status?.email);
                return (
                  <button
                    key={item.thread_id}
                    type="button"
                    onClick={() => void openThread(item.thread_id)}
                    className={`w-full text-left px-4 py-3 transition ${
                      active ? "bg-emerald-600/15" : "hover:bg-slate-900/60"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <span className="mt-0.5 shrink-0 w-8 h-8 rounded-full bg-slate-800 text-slate-300 flex items-center justify-center text-sm font-medium">
                        {initialsFrom(label)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {item.unread_count > 0 && (
                            <span className="shrink-0 w-2 h-2 rounded-full bg-emerald-400" />
                          )}
                          <span
                            className={`truncate text-sm ${
                              item.unread_count > 0
                                ? "text-slate-100 font-semibold"
                                : "text-slate-300"
                            }`}
                          >
                            {label}
                          </span>
                          <span className="ml-auto shrink-0 text-[11px] text-slate-500">
                            {formatDate(item.latest_date)}
                          </span>
                        </div>
                        <div
                          className={`truncate text-sm ${
                            item.unread_count > 0 ? "text-slate-200" : "text-slate-400"
                          }`}
                        >
                          {item.subject}
                          <span className="ml-1 text-slate-500">
                            · {item.message_count} msg{item.message_count === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="truncate text-xs text-slate-500">{item.latest_preview}</div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 min-h-[50vh] flex flex-col bg-slate-950/30">
          {!selectedThreadId ? (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Select a conversation to read the thread.
            </div>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Loading conversation…
            </div>
          ) : thread ? (
            <div className="flex flex-col h-full min-h-0">
              <div className="px-5 py-4 border-b border-slate-800 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <h3 className="text-base font-semibold text-slate-100">{thread.subject}</h3>
                    <p className="mt-1 text-sm text-slate-400">
                      {participantsLabel(thread, status?.email)}
                      <span className="text-slate-500">
                        {" "}
                        · {thread.message_count} message
                        {thread.message_count === 1 ? "" : "s"}
                      </span>
                    </p>
                  </div>
                  {!showReplyForm && (
                    <button
                      type="button"
                      onClick={startReply}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium"
                    >
                      Reply
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 space-y-3">
                {thread.messages.map((message) => {
                  const outbound = message.direction === "outbound";
                  return (
                    <div
                      key={`${message.folder || "INBOX"}:${message.uid}`}
                      className={`flex ${outbound ? "justify-end" : "justify-start"}`}
                    >
                      <div
                        className={`max-w-[92%] rounded-2xl border px-4 py-3 ${
                          outbound
                            ? "bg-emerald-600/15 border-emerald-500/30"
                            : "bg-slate-900/80 border-slate-700"
                        }`}
                      >
                        <div className="flex items-center gap-2 text-xs text-slate-400 mb-2">
                          <span className="font-medium text-slate-200">
                            {outbound
                              ? "You"
                              : senderLabel(message.from_name, message.from_email)}
                          </span>
                          {message.from_email && !outbound ? (
                            <span className="truncate text-slate-500">{message.from_email}</span>
                          ) : null}
                          <span className="ml-auto shrink-0">{formatDate(message.date)}</span>
                        </div>
                        <MessageBody message={message} />
                        {message.attachments?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {message.attachments.map((a, idx) => (
                              <span
                                key={`${a.filename ?? "file"}-${idx}`}
                                className="rounded border border-slate-700 bg-slate-950/60 px-2 py-0.5 text-[11px] text-slate-400"
                              >
                                {a.filename || "attachment"}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                <div ref={conversationEndRef} />
              </div>

              {showReplyForm && (
                <div className="px-5 py-4 border-t border-slate-800 space-y-2 bg-slate-950/50">
                  {notice && (
                    <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm">
                      {notice}
                    </div>
                  )}
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-14 shrink-0 text-slate-500">To</span>
                    <input
                      type="email"
                      value={replyTo}
                      onChange={(e) => setReplyTo(e.target.value)}
                      className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-14 shrink-0 text-slate-500">Cc</span>
                    <input
                      type="text"
                      value={replyCc}
                      onChange={(e) => setReplyCc(e.target.value)}
                      placeholder="optional"
                      className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="w-14 shrink-0 text-slate-500">Subject</span>
                    <input
                      type="text"
                      value={replySubjectLine}
                      onChange={(e) => setReplySubjectLine(e.target.value)}
                      className="flex-1 rounded-lg bg-slate-950 border border-slate-700 px-3 py-1.5 text-sm"
                    />
                  </div>
                  <textarea
                    value={replyBody}
                    onChange={(e) => setReplyBody(e.target.value)}
                    placeholder="Write your reply above the quoted message…"
                    rows={7}
                    className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm resize-y min-h-[140px]"
                    autoFocus
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowReplyForm(false);
                        setReplyBody("");
                        setNotice(null);
                      }}
                      className="px-3 py-2 rounded-lg border border-slate-700 text-slate-300 text-sm hover:bg-slate-900"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => void sendReply()}
                      disabled={sending || !replyBody.trim() || !replyTo.trim()}
                      className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium disabled:opacity-50"
                    >
                      {sending ? "Sending…" : "Send reply"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Conversation not found.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
