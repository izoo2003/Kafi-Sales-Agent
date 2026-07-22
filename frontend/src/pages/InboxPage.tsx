import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  client,
  type InboxAnalyzeResponse,
  type InboxMessageDetail,
  type InboxMessageSummary,
  type InboxStatus,
  type InboxThreadDetail,
  type InboxThreadSummary,
} from "../api/client";
import type { MailSection } from "../components/AppSidebar";
import { alertNewInboxMessage, unlockNotificationAudio } from "../utils/notify";

interface InboxPageProps {
  section: MailSection;
  onError: (message: string) => void;
  onUnreadChange?: (count: number) => void;
  onFolderCountsChange?: (counts: {
    inbox: number;
    sent: number;
    trash: number;
    archive: number;
  }) => void;
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

function sectionTitle(section: MailSection): string {
  if (section === "sent") return "Sent";
  if (section === "trash") return "Trash";
  if (section === "archive") return "Archive";
  return "Inbox";
}

function sectionDescription(section: MailSection, email?: string | null): string {
  const mailbox = email ? email : "Company mailbox";
  if (section === "sent") return `${mailbox} · Messages you sent`;
  if (section === "trash") return `${mailbox} · Deleted messages`;
  if (section === "archive") return `${mailbox} · Archived messages`;
  return mailbox;
}

function emptyListMessage(section: MailSection): string {
  if (section === "sent") return "No sent messages.";
  if (section === "trash") return "Trash is empty.";
  if (section === "archive") return "No archived messages.";
  return "No conversations.";
}

function messageListLabel(message: InboxMessageSummary, section: MailSection): string {
  if (section === "sent") {
    const to = message.to?.[0];
    return to || "No recipient";
  }
  return senderLabel(message.from_name, message.from_email);
}

function isRichHtml(html: string): boolean {
  // Keep the white iframe only when the mail needs real HTML layout
  // (images, tables, heavy styling). Simple Outlook wrappers stay as dark text.
  if (/<(?:img|table|td|tr|th|iframe|video)\b/i.test(html)) return true;
  if (html.length > 2500 && /style\s*=/i.test(html)) return true;
  return false;
}

function MessageBody({ message }: { message: InboxMessageDetail }) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [height, setHeight] = useState(48);
  const html = message.body_html?.trim();
  const text = message.body_text?.trim();
  const useIframe = Boolean(html && isRichHtml(html));

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !useIframe || !html) return;
    setHeight(48);
    iframe.srcdoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><base target="_blank"><style>
      html,body{margin:0;padding:0;background:#fff;}
      body{font-family:Segoe UI,system-ui,sans-serif;color:#0f172a;padding:8px 10px;font-size:14px;line-height:1.5;word-break:break-word;}
      img,video{max-width:100%;height:auto;}
      a{color:#0369a1;}
      pre,code{white-space:pre-wrap;word-break:break-word;}
      p{margin:0 0 0.6em;}
      p:last-child{margin-bottom:0;}
    </style></head><body>${html}</body></html>`;
  }, [html, message.uid, message.folder, useIframe]);

  if (useIframe && html) {
    return (
      <iframe
        ref={iframeRef}
        title={`Message ${message.uid}`}
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        onLoad={() => {
          try {
            const doc = iframeRef.current?.contentDocument;
            const next =
              doc?.body?.scrollHeight || doc?.documentElement?.scrollHeight || 0;
            if (next > 0) setHeight(Math.min(Math.max(next + 4, 36), 720));
          } catch {
            setHeight(160);
          }
        }}
        style={{ height, maxHeight: 720 }}
        className="w-full border-0 rounded-md bg-white block"
      />
    );
  }

  const plain =
    text ||
    (html ? stripHtml(html) : "") ||
    message.preview ||
    "(empty message)";

  return (
    <pre className="whitespace-pre-wrap break-words text-sm text-slate-200 font-sans m-0 leading-relaxed">
      {plain}
    </pre>
  );
}

export function InboxPage({
  section,
  onError,
  onUnreadChange,
  onFolderCountsChange,
}: InboxPageProps) {
  const [status, setStatus] = useState<InboxStatus | null>(null);
  const [threads, setThreads] = useState<InboxThreadSummary[]>([]);
  const [messages, setMessages] = useState<InboxMessageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [selectedMessageKey, setSelectedMessageKey] = useState<string | null>(null);
  const [thread, setThread] = useState<InboxThreadDetail | null>(null);
  const [messageDetail, setMessageDetail] = useState<InboxMessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [moving, setMoving] = useState(false);
  const [emptyingTrash, setEmptyingTrash] = useState(false);

  const [replyBody, setReplyBody] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [replyCc, setReplyCc] = useState("");
  const [replySubjectLine, setReplySubjectLine] = useState("");
  const [showReplyForm, setShowReplyForm] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<InboxAnalyzeResponse | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const pollTimerRef = useRef<number | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const onErrorRef = useRef(onError);
  const onUnreadChangeRef = useRef(onUnreadChange);
  const onFolderCountsChangeRef = useRef(onFolderCountsChange);
  onErrorRef.current = onError;
  onUnreadChangeRef.current = onUnreadChange;
  onFolderCountsChangeRef.current = onFolderCountsChange;
  const loadGenerationRef = useRef(0);
  const analyzeGenerationRef = useRef(0);
  const isThreadView = section === "inbox";

  const refreshFolderCounts = useCallback(async () => {
    if (!onFolderCountsChangeRef.current) return;
    try {
      const result = await client.listInboxFolders();
      const next = { inbox: 0, sent: 0, trash: 0, archive: 0 };
      for (const folder of result.folders) {
        if (
          folder.key === "inbox" ||
          folder.key === "sent" ||
          folder.key === "trash" ||
          folder.key === "archive"
        ) {
          next[folder.key] = folder.count;
        }
      }
      onFolderCountsChangeRef.current(next);
    } catch {
      /* optional */
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedThreadId(null);
    setSelectedMessageKey(null);
    setThread(null);
    setMessageDetail(null);
    setShowReplyForm(false);
    setReplyBody("");
    setAiAnalysis(null);
    setAiLoading(false);
    analyzeGenerationRef.current += 1;
  }, []);

  const applyAiDraftToReplyForm = useCallback((analysis: InboxAnalyzeResponse) => {
    if (analysis.to?.trim()) setReplyTo(analysis.to.trim());
    if (analysis.suggested_subject?.trim()) {
      setReplySubjectLine(analysis.suggested_subject.trim());
    }
    setReplyBody(analysis.draft_reply);
    setShowReplyForm(true);
    setNotice(null);
  }, []);

  const runThreadAnalyze = useCallback(async (threadId: string) => {
    const generation = ++analyzeGenerationRef.current;
    setAiLoading(true);
    setAiAnalysis(null);
    try {
      const result = await client.analyzeInboxThread(threadId);
      if (generation !== analyzeGenerationRef.current) return;
      setAiAnalysis(result);
    } catch (e) {
      if (generation !== analyzeGenerationRef.current) return;
      onErrorRef.current(
        e instanceof Error ? e.message : "AI assistant could not analyze this email",
      );
    } finally {
      if (generation === analyzeGenerationRef.current) setAiLoading(false);
    }
  }, []);

  const runMessageAnalyze = useCallback(async (uid: string, folder: string) => {
    const generation = ++analyzeGenerationRef.current;
    setAiLoading(true);
    setAiAnalysis(null);
    try {
      const result = await client.analyzeInboxMessage(uid, { folder });
      if (generation !== analyzeGenerationRef.current) return;
      setAiAnalysis(result);
    } catch (e) {
      if (generation !== analyzeGenerationRef.current) return;
      onErrorRef.current(
        e instanceof Error ? e.message : "AI assistant could not analyze this email",
      );
    } finally {
      if (generation === analyzeGenerationRef.current) setAiLoading(false);
    }
  }, []);

  const loadList = useCallback(
    async (options?: { silent?: boolean }) => {
      const generation = ++loadGenerationRef.current;
      if (!options?.silent) setLoading(true);
      try {
        const s = await client.getInboxStatus();
        if (generation !== loadGenerationRef.current) return;
        setStatus(s);
        onUnreadChangeRef.current?.(s.unread_count);
        if (!s.configured) {
          setThreads([]);
          setMessages([]);
          return;
        }
        if (section === "inbox") {
          const rows = await client.listInboxThreads({ limit: 40, unread_only: unreadOnly });
          if (generation !== loadGenerationRef.current) return;
          setThreads(rows);
          setMessages([]);
        } else {
          const rows = await client.listInboxMessages({
            limit: 40,
            unread_only: unreadOnly && section !== "sent",
            folder: section,
          });
          if (generation !== loadGenerationRef.current) return;
          setMessages(rows);
          setThreads([]);
        }
        // Counts are secondary — never block the message list on them.
        void refreshFolderCounts();
      } catch (e) {
        if (!options?.silent && generation === loadGenerationRef.current) {
          onErrorRef.current(e instanceof Error ? e.message : "Failed to load mail");
        }
      } finally {
        if (!options?.silent && generation === loadGenerationRef.current) {
          setLoading(false);
        }
      }
    },
    [refreshFolderCounts, section, unreadOnly],
  );

  useEffect(() => {
    clearSelection();
    setNotice(null);
    setUnreadOnly(false);
  }, [clearSelection, section]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!status?.configured) return;
    pollTimerRef.current = window.setInterval(() => {
      void loadList({ silent: true });
    }, 60_000);
    return () => {
      if (pollTimerRef.current !== null) window.clearInterval(pollTimerRef.current);
    };
  }, [status?.configured, loadList]);

  const openThread = useCallback(
    async (threadId: string) => {
      setSelectedThreadId(threadId);
      setSelectedMessageKey(null);
      setMessageDetail(null);
      setThread(null);
      setDetailLoading(true);
      setNotice(null);
      setShowReplyForm(false);
      setReplyBody("");
      setReplyCc("");
      setAiAnalysis(null);
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
        // Don't block the open conversation on badge refresh / AI analyze.
        void client
          .getInboxStatus()
          .then((s) => {
            onUnreadChangeRef.current?.(s.unread_count);
            setStatus(s);
          })
          .catch(() => {
            /* ignore */
          });
        void runThreadAnalyze(threadId);
      } catch (e) {
        onErrorRef.current(e instanceof Error ? e.message : "Failed to open conversation");
      } finally {
        setDetailLoading(false);
      }
    },
    [runThreadAnalyze],
  );

  const openMessage = useCallback(
    async (message: InboxMessageSummary) => {
      const folder = message.folder || "INBOX";
      const key = `${folder}:${message.uid}`;
      setSelectedMessageKey(key);
      setSelectedThreadId(null);
      setThread(null);
      setMessageDetail(null);
      setDetailLoading(true);
      setNotice(null);
      setShowReplyForm(false);
      setAiAnalysis(null);
      try {
        const detail = await client.getInboxMessage(message.uid, folder);
        setMessageDetail(detail);
        setReplySubjectLine(replySubject(detail.subject));
        if (detail.direction === "outbound") {
          setReplyTo((detail.to && detail.to[0]) || "");
        } else {
          setReplyTo(detail.from_email || "");
        }
        if (detail.unread) {
          try {
            const unread = await client.markInboxMessageRead(message.uid, folder);
            onUnreadChangeRef.current?.(unread.count);
            setMessages((prev) =>
              prev.map((m) =>
                m.uid === message.uid && (m.folder || "INBOX") === folder
                  ? { ...m, unread: false }
                  : m,
              ),
            );
          } catch {
            /* mark-read is best-effort */
          }
        }
        void runMessageAnalyze(message.uid, folder);
      } catch (e) {
        onErrorRef.current(e instanceof Error ? e.message : "Failed to open message");
      } finally {
        setDetailLoading(false);
      }
    },
    [runMessageAnalyze],
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
    if (aiAnalysis?.draft_reply?.trim()) {
      applyAiDraftToReplyForm(aiAnalysis);
      return;
    }
    if (isThreadView) {
      if (!thread || !replyTarget) return;
      setShowReplyForm(true);
      setNotice(null);
      if (!replyBody.trim()) {
        setReplyBody(buildQuotedReply(replyTarget));
      }
      return;
    }
    if (!messageDetail) return;
    setShowReplyForm(true);
    setNotice(null);
    if (!replyBody.trim()) {
      setReplyBody(buildQuotedReply(messageDetail));
    }
  }

  async function sendReply() {
    if (!replyBody.trim()) return;
    setSending(true);
    setNotice(null);
    try {
      if (selectedThreadId) {
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
      } else if (messageDetail) {
        const result = await client.replyInboxMessage(messageDetail.uid, {
          body: replyBody,
          to: replyTo.trim() || undefined,
          subject: replySubjectLine.trim() || undefined,
          cc: replyCc.trim() || undefined,
          folder: messageDetail.folder || "INBOX",
        });
        setNotice(`Reply sent to ${result.to ?? replyTo}.`);
        setReplyBody("");
        setShowReplyForm(false);
        await openMessage(messageDetail);
      }
      await loadList({ silent: true });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  async function moveThread(toFolder: "trash" | "archive") {
    if (!selectedThreadId) return;
    setMoving(true);
    setNotice(null);
    try {
      const result = await client.moveInboxThread(selectedThreadId, toFolder);
      setNotice(result.message);
      clearSelection();
      await loadList({ silent: true });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to move conversation");
    } finally {
      setMoving(false);
    }
  }

  async function moveSelectedMessage(toFolder: "inbox" | "trash" | "archive") {
    if (!messageDetail) return;
    setMoving(true);
    setNotice(null);
    try {
      const result = await client.moveInboxMessage(messageDetail.uid, {
        from_folder: messageDetail.folder || "INBOX",
        to_folder: toFolder,
      });
      setNotice(result.message);
      clearSelection();
      await loadList({ silent: true });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to move message");
    } finally {
      setMoving(false);
    }
  }

  async function handleEmptyTrash() {
    const confirmed = window.confirm(
      "Permanently delete all messages in Trash? This cannot be undone.",
    );
    if (!confirmed) return;
    setEmptyingTrash(true);
    setNotice(null);
    try {
      const result = await client.emptyInboxTrash();
      setNotice(result.message);
      clearSelection();
      await loadList();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to empty trash");
    } finally {
      setEmptyingTrash(false);
    }
  }

  async function resetCutoff() {
    try {
      const { showing_since } = await client.resetInboxCutoff();
      setNotice(`Only showing mail received after ${new Date(showing_since).toLocaleString()}.`);
      clearSelection();
      await loadList();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to reset inbox cutoff");
    }
  }

  async function showAllMail() {
    try {
      await client.clearInboxCutoff();
      setNotice("Showing all mailbox conversations.");
      clearSelection();
      setUnreadOnly(false);
      await loadList();
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
        <h2 className="text-lg font-medium text-slate-100">Mail</h2>
        <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/40 text-slate-400 text-sm space-y-2">
          <p>Mail is not enabled yet.</p>
          <p>
            Set <code className="text-slate-300">MAILBOX_ENABLED=true</code>,{" "}
            <code className="text-slate-300">MAILBOX_EMAIL</code>, and{" "}
            <code className="text-slate-300">MAILBOX_PASSWORD</code> (plus IMAP/SMTP host
            and ports) in <code className="text-slate-300">backend/.env</code>, then
            restart the backend.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-medium text-slate-100">{sectionTitle(section)}</h2>
          <p className="text-sm text-slate-500 mt-1">
            {sectionDescription(section, status?.email)}
            {section === "inbox" && status ? ` · ${status.unread_count} unread` : ""}
          </p>
          {section === "inbox" && status?.showing_since && (
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
          {section === "trash" && (
            <button
              type="button"
              onClick={() => void handleEmptyTrash()}
              disabled={emptyingTrash || messages.length === 0}
              className="px-3 py-2 rounded-lg bg-red-900/50 hover:bg-red-800 border border-red-800/50 text-red-100 text-sm disabled:opacity-50"
            >
              {emptyingTrash ? "Emptying…" : "Empty Trash"}
            </button>
          )}
          {section === "inbox" && (
            <button
              type="button"
              onClick={() => void resetCutoff()}
              className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-sm"
              title="Hide mail received before right now"
            >
              New mail only
            </button>
          )}
          {section !== "sent" && (
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={(e) => setUnreadOnly(e.target.checked)}
                className="accent-emerald-600"
              />
              Unread only
            </label>
          )}
          <button
            type="button"
            onClick={() => void loadList()}
            className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm"
          >
            Refresh
          </button>
          {section === "inbox" && (
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
          )}
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
              <p className="py-10 text-center text-slate-500 text-sm">
                {isThreadView ? "Loading conversations…" : "Loading messages…"}
              </p>
            ) : isThreadView ? (
              threads.length === 0 ? (
                <p className="py-10 text-center text-slate-500 text-sm">{emptyListMessage(section)}</p>
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
              )
            ) : messages.length === 0 ? (
              <p className="py-10 text-center text-slate-500 text-sm">{emptyListMessage(section)}</p>
            ) : (
              messages.map((item) => {
                const folder = item.folder || "INBOX";
                const key = `${folder}:${item.uid}`;
                const active = key === selectedMessageKey;
                const label = messageListLabel(item, section);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => void openMessage(item)}
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
                          {item.unread && (
                            <span className="shrink-0 w-2 h-2 rounded-full bg-emerald-400" />
                          )}
                          <span
                            className={`truncate text-sm ${
                              item.unread ? "text-slate-100 font-semibold" : "text-slate-300"
                            }`}
                          >
                            {label}
                          </span>
                          <span className="ml-auto shrink-0 text-[11px] text-slate-500">
                            {formatDate(item.date)}
                          </span>
                        </div>
                        <div
                          className={`truncate text-sm ${
                            item.unread ? "text-slate-200" : "text-slate-400"
                          }`}
                        >
                          {item.subject}
                        </div>
                        <div className="truncate text-xs text-slate-500">{item.preview}</div>
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-xl border border-slate-800 min-h-[50vh] flex flex-col bg-slate-950/30">
          {isThreadView ? (
            !selectedThreadId ? (
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
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void moveThread("archive")}
                        disabled={moving}
                        className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-sm hover:bg-slate-900 disabled:opacity-50"
                      >
                        Archive
                      </button>
                      <button
                        type="button"
                        onClick={() => void moveThread("trash")}
                        disabled={moving}
                        className="shrink-0 px-3 py-1.5 rounded-lg border border-red-800/50 text-red-200 text-sm hover:bg-red-950/40 disabled:opacity-50"
                      >
                        Move to Trash
                      </button>
                      {!showReplyForm && (
                        <button
                          type="button"
                          onClick={startReply}
                          className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium"
                        >
                          {aiAnalysis?.draft_reply ? "Use AI draft" : "Reply"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {(aiLoading || aiAnalysis) && (
                  <div className="mx-4 mt-3 rounded-xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 space-y-3 shrink-0">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-sky-300/90">
                          AI assistant
                        </p>
                        {aiLoading ? (
                          <p className="mt-1 text-sm text-slate-300">Reading this email…</p>
                        ) : (
                          <p className="mt-1 text-sm text-slate-200 leading-relaxed">
                            {aiAnalysis?.summary}
                          </p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {selectedThreadId && (
                          <button
                            type="button"
                            onClick={() => void runThreadAnalyze(selectedThreadId)}
                            disabled={aiLoading}
                            className="px-2.5 py-1 rounded-lg border border-sky-500/40 text-sky-200 text-xs hover:bg-sky-500/10 disabled:opacity-50"
                          >
                            Refresh analysis
                          </button>
                        )}
                        {aiAnalysis?.draft_reply && !showReplyForm && (
                          <button
                            type="button"
                            onClick={() => applyAiDraftToReplyForm(aiAnalysis)}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                          >
                            Edit &amp; send draft
                          </button>
                        )}
                      </div>
                    </div>
                    {aiAnalysis?.draft_reply && !showReplyForm && (
                      <div className="rounded-lg border border-slate-700/80 bg-slate-950/50 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                          Suggested reply
                          {aiAnalysis.source === "fallback" ? " (template)" : ""}
                        </p>
                        <pre className="whitespace-pre-wrap break-words text-sm text-slate-300 font-sans m-0 max-h-40 overflow-y-auto">
                          {aiAnalysis.draft_reply}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

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
                      placeholder="Edit the AI draft or write your reply…"
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
            )
          ) : !selectedMessageKey ? (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Select a message to read it.
            </div>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
              Loading message…
            </div>
          ) : messageDetail ? (
            <div className="flex flex-col h-full min-h-0">
              <div className="px-5 py-4 border-b border-slate-800 space-y-2">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold text-slate-100">
                      {messageDetail.subject}
                    </h3>
                    <p className="mt-1 text-sm text-slate-400">
                      {section === "sent"
                        ? `To ${(messageDetail.to || []).join(", ") || "—"}`
                        : senderLabel(messageDetail.from_name, messageDetail.from_email)}
                      {messageDetail.from_email && section !== "sent" ? (
                        <span className="text-slate-500"> · {messageDetail.from_email}</span>
                      ) : null}
                      <span className="text-slate-500">
                        {" "}
                        · {formatDate(messageDetail.date)}
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(section === "trash" || section === "archive") && (
                      <button
                        type="button"
                        onClick={() => void moveSelectedMessage("inbox")}
                        disabled={moving}
                        className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-sm hover:bg-slate-900 disabled:opacity-50"
                      >
                        Restore to Inbox
                      </button>
                    )}
                    {section === "archive" && (
                      <button
                        type="button"
                        onClick={() => void moveSelectedMessage("trash")}
                        disabled={moving}
                        className="shrink-0 px-3 py-1.5 rounded-lg border border-red-800/50 text-red-200 text-sm hover:bg-red-950/40 disabled:opacity-50"
                      >
                        Move to Trash
                      </button>
                    )}
                    {section === "sent" && (
                      <>
                        <button
                          type="button"
                          onClick={() => void moveSelectedMessage("archive")}
                          disabled={moving}
                          className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-sm hover:bg-slate-900 disabled:opacity-50"
                        >
                          Archive
                        </button>
                        <button
                          type="button"
                          onClick={() => void moveSelectedMessage("trash")}
                          disabled={moving}
                          className="shrink-0 px-3 py-1.5 rounded-lg border border-red-800/50 text-red-200 text-sm hover:bg-red-950/40 disabled:opacity-50"
                        >
                          Move to Trash
                        </button>
                      </>
                    )}
                    {section !== "sent" && !showReplyForm && (
                      <button
                        type="button"
                        onClick={startReply}
                        className="shrink-0 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium"
                      >
                        {aiAnalysis?.draft_reply ? "Use AI draft" : "Reply"}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {(aiLoading || aiAnalysis) && (
                <div className="mx-4 mt-3 rounded-xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 space-y-3 shrink-0">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-sky-300/90">
                        AI assistant
                      </p>
                      {aiLoading ? (
                        <p className="mt-1 text-sm text-slate-300">Reading this email…</p>
                      ) : (
                        <p className="mt-1 text-sm text-slate-200 leading-relaxed">
                          {aiAnalysis?.summary}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {messageDetail && (
                        <button
                          type="button"
                          onClick={() =>
                            void runMessageAnalyze(
                              messageDetail.uid,
                              messageDetail.folder || "INBOX",
                            )
                          }
                          disabled={aiLoading}
                          className="px-2.5 py-1 rounded-lg border border-sky-500/40 text-sky-200 text-xs hover:bg-sky-500/10 disabled:opacity-50"
                        >
                          Refresh analysis
                        </button>
                      )}
                      {section !== "sent" && aiAnalysis?.draft_reply && !showReplyForm && (
                        <button
                          type="button"
                          onClick={() => applyAiDraftToReplyForm(aiAnalysis)}
                          className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
                        >
                          Edit &amp; send draft
                        </button>
                      )}
                    </div>
                  </div>
                  {aiAnalysis?.draft_reply && section !== "sent" && !showReplyForm && (
                    <div className="rounded-lg border border-slate-700/80 bg-slate-950/50 px-3 py-2">
                      <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
                        Suggested reply
                        {aiAnalysis.source === "fallback" ? " (template)" : ""}
                      </p>
                      <pre className="whitespace-pre-wrap break-words text-sm text-slate-300 font-sans m-0 max-h-40 overflow-y-auto">
                        {aiAnalysis.draft_reply}
                      </pre>
                    </div>
                  )}
                </div>
              )}

              <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4">
                <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-4 py-3">
                  <MessageBody message={messageDetail} />
                  {messageDetail.attachments?.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {messageDetail.attachments.map((a, idx) => (
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

              {showReplyForm && section !== "sent" && (
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
                    placeholder="Edit the AI draft, then send…"
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
              Message not found.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
