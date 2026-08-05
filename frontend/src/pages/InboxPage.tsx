import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  client,
  type InboxAnalyzeResponse,
  type InboxMessageDetail,
  type InboxMessageSummary,
  type InboxStatus,
  type InboxThreadDetail,
  type InboxThreadSummary,
  type MailComposeDraft,
  type MailLabel,
  type MailLabelMessageKey,
} from "../api/client";
import {
  isMailLabelSection,
  mailLabelIdFromSection,
  type MailSection,
} from "../components/AppSidebar";
import { ComposeMailModal } from "../components/ComposeMailModal";
import {
  EmailBodyEditor,
  emailBodyHasContent,
} from "../components/EmailBodyEditor";
import { ActionButton } from "../components/ui/ActionButton";
import {
  IconArchive,
  IconFilter,
  IconInbox,
  IconPlus,
  IconRefresh,
  IconReply,
  IconSend,
  IconSparkles,
  IconTag,
  IconTrash,
  IconX,
} from "../components/icons/AppIcons";
import { alertNewInboxMessage, unlockNotificationAudio } from "../utils/notify";
import {
  buildReplyRecipients,
  hasReplyAllTargets,
} from "../utils/replyRecipients";

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
  onMailExtrasChange?: () => void;
  /** Open Vercel mailer compose (mailer-pied). */
  onOpenMailerCompose?: () => void;
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

function sectionTitle(section: MailSection, labels: MailLabel[] = []): string {
  if (section === "sent") return "Sent";
  if (section === "trash") return "Trash";
  if (section === "archive") return "Archive";
  if (section === "drafts") return "Drafts";
  if (isMailLabelSection(section)) {
    const id = mailLabelIdFromSection(section);
    return labels.find((l) => l.id === id)?.name || "Label";
  }
  return "Inbox";
}

function sectionDescription(section: MailSection, email?: string | null): string {
  const mailbox = email ? email : "Company mailbox";
  if (section === "sent") return `${mailbox} · Messages you sent`;
  if (section === "trash") return `${mailbox} · Deleted messages`;
  if (section === "archive") return `${mailbox} · Archived messages`;
  if (section === "drafts") return `${mailbox} · Unsent compose drafts`;
  if (isMailLabelSection(section)) return `${mailbox} · Labeled messages`;
  return mailbox;
}

function emptyListMessage(section: MailSection): string {
  if (section === "sent") return "No sent messages.";
  if (section === "trash") return "Trash is empty.";
  if (section === "archive") return "No archived messages.";
  if (section === "drafts") return "No drafts.";
  if (isMailLabelSection(section)) return "No messages in this label.";
  return "No conversations.";
}

function normSubject(subject: string | null | undefined): string {
  if (!subject) return "";
  return subject
    .replace(/^(re|fw|fwd)\s*:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function messageMatchesLabelKeys(
  message: InboxMessageSummary,
  keys: MailLabelMessageKey[],
): boolean {
  const uid = String(message.uid);
  const folder = (message.folder || "inbox").toLowerCase();
  const subjectKey = normSubject(message.subject);
  const from = (message.from_email || "").trim().toLowerCase();
  for (const key of keys) {
    if (String(key.message_uid) === uid && key.folder.toLowerCase() === folder) {
      return true;
    }
    if (key.subject_key && subjectKey && key.subject_key === subjectKey) return true;
    if (key.from_email && from && key.from_email.toLowerCase() === from) return true;
  }
  return false;
}

function normalizeMatchQuery(raw: string | null | undefined): string {
  if (!raw) return "";
  let text = raw.trim().toLowerCase();
  if (!text) return "";
  // Multi-word name → first meaningful token (e.g. "LinkedIn jobs" → linkedin)
  if (!text.includes("://") && !text.includes("/") && text.includes(" ")) {
    const part =
      text
        .split(/[\s/_-]+/)
        .map((p) => p.replace(/^www\./, "").trim())
        .find((p) => p.length >= 3) || "";
    return part;
  }
  text = text.replace(/^https?:\/\//i, "");
  text = text.replace(/^www\./i, "");
  text = text.split("/")[0]?.split("?")[0] || text;
  return text.trim();
}

/** Tokens that route mail into a label (match_query and/or label name). */
function labelMatchTokens(label: Pick<MailLabel, "name" | "match_query">): string[] {
  const tokens: string[] = [];
  const primary = normalizeMatchQuery(label.match_query) || normalizeMatchQuery(label.name);
  if (primary) {
    tokens.push(primary);
    if (primary.includes(".")) {
      const base = primary.split(".")[0]?.trim() || "";
      if (base.length >= 3 && !tokens.includes(base)) tokens.push(base);
    }
  }
  for (const part of (label.name || "").toLowerCase().split(/[\s/_-]+/)) {
    const cleaned = part.replace(/^www\./, "").trim();
    if (cleaned.length >= 3 && !cleaned.includes(".") && !tokens.includes(cleaned)) {
      tokens.push(cleaned);
    }
  }
  return tokens;
}

function emailMatchesQuery(email: string | null | undefined, query: string): boolean {
  if (!query || !email) return false;
  const value = email.trim().toLowerCase();
  const domain = value.includes("@") ? value.split("@").pop() || "" : value;
  if (!domain) return false;
  if (domain === query) return true;
  if (domain.endsWith(`.${query}`)) return true;
  if (domain.includes(query)) return true;
  if (value.includes(query)) return true;
  return false;
}

function textMatchesQuery(text: string | null | undefined, query: string): boolean {
  if (!query || !text) return false;
  return text.toLowerCase().includes(query);
}

function messageMatchesDomainLabel(
  message: Pick<
    InboxMessageSummary,
    "from_email" | "to" | "subject" | "preview"
  > & {
    from_name?: string | null;
    body_text?: string | null;
  },
  label: MailLabel,
): boolean {
  const tokens = labelMatchTokens(label);
  if (!tokens.length) return false;
  for (const query of tokens) {
    if (emailMatchesQuery(message.from_email, query)) return true;
    if ((message.to || []).some((addr) => emailMatchesQuery(addr, query))) return true;
    if (textMatchesQuery(message.from_name, query)) return true;
    if (textMatchesQuery(message.subject, query)) return true;
    if (textMatchesQuery(message.preview, query)) return true;
    if (textMatchesQuery(message.body_text, query)) return true;
  }
  return false;
}

function threadMatchesAnyDomainLabel(thread: InboxThreadSummary, labels: MailLabel[]): boolean {
  return labels.some((label) => {
    const tokens = labelMatchTokens(label);
    if (!tokens.length) return false;
    return tokens.some((query) => {
      if (emailMatchesQuery(thread.latest_from_email, query)) return true;
      if ((thread.participants || []).some((p) => emailMatchesQuery(p, query))) return true;
      if (textMatchesQuery(thread.subject, query)) return true;
      if (textMatchesQuery(thread.latest_preview, query)) return true;
      return false;
    });
  });
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
  onMailExtrasChange,
  onOpenMailerCompose,
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
  const [showCompose, setShowCompose] = useState(false);
  const [composeDraft, setComposeDraft] = useState<MailComposeDraft | null>(null);
  const [drafts, setDrafts] = useState<MailComposeDraft[]>([]);
  const [labels, setLabels] = useState<MailLabel[]>([]);
  const [messageLabels, setMessageLabels] = useState<MailLabel[]>([]);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelDomain, setNewLabelDomain] = useState("");
  const [creatingLabel, setCreatingLabel] = useState(false);
  const [labelMenuOpen, setLabelMenuOpen] = useState(false);
  const [assigningLabel, setAssigningLabel] = useState(false);

  const pollTimerRef = useRef<number | null>(null);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);
  const onErrorRef = useRef(onError);
  const onUnreadChangeRef = useRef(onUnreadChange);
  const onFolderCountsChangeRef = useRef(onFolderCountsChange);
  const onMailExtrasChangeRef = useRef(onMailExtrasChange);
  onErrorRef.current = onError;
  onUnreadChangeRef.current = onUnreadChange;
  onFolderCountsChangeRef.current = onFolderCountsChange;
  onMailExtrasChangeRef.current = onMailExtrasChange;
  const loadGenerationRef = useRef(0);
  const analyzeGenerationRef = useRef(0);
  const labelId = mailLabelIdFromSection(section);
  const isLabelView = labelId != null;
  const isDraftsView = section === "drafts";
  const isFolderMail =
    section === "inbox" ||
    section === "sent" ||
    section === "trash" ||
    section === "archive" ||
    isLabelView;
  const isThreadView = section === "inbox" && !isLabelView;

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
    setMessageLabels([]);
    setLabelMenuOpen(false);
    analyzeGenerationRef.current += 1;
  }, []);

  const applyAiDraftToReplyForm = useCallback((analysis: InboxAnalyzeResponse) => {
    if (analysis.to?.trim()) setReplyTo(analysis.to.trim());
    if (analysis.suggested_subject?.trim()) {
      setReplySubjectLine(analysis.suggested_subject.trim());
    }
    setReplyCc("");
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
        const [s, labelRows] = await Promise.all([
          client.getInboxStatus(),
          client.listMailLabels().catch(() => [] as MailLabel[]),
        ]);
        if (generation !== loadGenerationRef.current) return;
        setStatus(s);
        setLabels(labelRows);
        onUnreadChangeRef.current?.(s.unread_count);

        if (section === "drafts") {
          const rows = await client.listMailDrafts();
          if (generation !== loadGenerationRef.current) return;
          setDrafts(rows);
          setThreads([]);
          setMessages([]);
          onMailExtrasChangeRef.current?.();
          return;
        }

        if (!s.configured) {
          setThreads([]);
          setMessages([]);
          setDrafts([]);
          return;
        }

        if (section === "inbox") {
          const rows = await client.listInboxThreads({ limit: 80, unread_only: unreadOnly });
          if (generation !== loadGenerationRef.current) return;
          // Domain/URL labels route matching mail out of Inbox into that label only.
          const visible = rows.filter((thread) => !threadMatchesAnyDomainLabel(thread, labelRows));
          setThreads(visible);
          setMessages([]);
          setDrafts([]);
        } else if (isMailLabelSection(section)) {
          const id = mailLabelIdFromSection(section);
          if (id == null) {
            setMessages([]);
            setThreads([]);
            return;
          }
          const activeLabel = labelRows.find((l) => l.id === id) || null;
          const [keys, inboxRows, sentRows] = await Promise.all([
            client.listMailLabelMessages(id),
            client.listInboxMessages({ limit: 100, folder: "inbox" }),
            client.listInboxMessages({ limit: 40, folder: "sent" }),
          ]);
          if (generation !== loadGenerationRef.current) return;
          const combined = [...inboxRows, ...sentRows].filter((m) => {
            if (activeLabel && messageMatchesDomainLabel(m, activeLabel)) return true;
            return messageMatchesLabelKeys(m, keys);
          });
          setMessages(combined);
          setThreads([]);
          setDrafts([]);
        } else if (
          section === "sent" ||
          section === "trash" ||
          section === "archive"
        ) {
          const rows = await client.listInboxMessages({
            limit: 40,
            unread_only: unreadOnly && section !== "sent",
            folder: section,
          });
          if (generation !== loadGenerationRef.current) return;
          setMessages(rows);
          setThreads([]);
          setDrafts([]);
        } else {
          setThreads([]);
          setMessages([]);
          setDrafts([]);
        }
        void refreshFolderCounts();
        onMailExtrasChangeRef.current?.();
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
        const latestForLabels =
          latestInbound || detail.messages[detail.messages.length - 1];
        if (latestForLabels) {
          void client
            .mapMailLabelsByUids(
              (latestForLabels.folder || "inbox").toLowerCase(),
              [String(latestForLabels.uid)],
            )
            .then((mapped) => {
              setMessageLabels(mapped[String(latestForLabels.uid)] || []);
            })
            .catch(() => setMessageLabels([]));
        } else {
          setMessageLabels([]);
        }
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
        void client
          .mapMailLabelsByUids(folder.toLowerCase(), [String(detail.uid)])
          .then((mapped) => setMessageLabels(mapped[String(detail.uid)] || []))
          .catch(() => setMessageLabels([]));
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

  function startReply(mode: "reply" | "reply_all" = "reply") {
    const mailbox = status?.email || status?.emails?.[0] || null;
    const source = isThreadView ? replyTarget : messageDetail;
    if (!source) return;

    const recipients = buildReplyRecipients(source, mailbox, mode);
    setReplyTo(recipients.to);
    setReplyCc(recipients.cc);
    setShowReplyForm(true);
    setNotice(null);

    if (mode === "reply" && aiAnalysis?.draft_reply?.trim()) {
      setReplyBody(aiAnalysis.draft_reply);
      if (aiAnalysis.suggested_subject?.trim()) {
        setReplySubjectLine(aiAnalysis.suggested_subject.trim());
      }
      if (aiAnalysis.to?.trim()) setReplyTo(aiAnalysis.to.trim());
      return;
    }

    // Clean empty compose box — do not quote the prior thread.
    setReplyBody("");
  }

  const canReplyAll = useMemo(() => {
    const mailbox = status?.email || status?.emails?.[0] || null;
    const source = isThreadView ? replyTarget : messageDetail;
    if (!source) return false;
    return hasReplyAllTargets(source, mailbox);
  }, [isThreadView, replyTarget, messageDetail, status?.email, status?.emails]);

  async function sendReply() {
    if (!emailBodyHasContent(replyBody)) return;
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
        const ccNote = replyCc.trim() ? ` (Cc: ${replyCc.trim()})` : "";
        setNotice(`Reply sent to ${result.to ?? replyTo}${ccNote}.`);
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
        const ccNote = replyCc.trim() ? ` (Cc: ${replyCc.trim()})` : "";
        setNotice(`Reply sent to ${result.to ?? replyTo}${ccNote}.`);
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

  if (
    section === "activity" ||
    section === "email-templates" ||
    section === "personalized-emails"
  ) {
    return null;
  }

  if (!loading && status && !status.configured && !isDraftsView) {
    return (
      <section className="space-y-4 w-full min-w-0">
        <h2 className="text-lg font-medium text-slate-100">Mail</h2>
        <div className="p-6 rounded-xl border border-slate-800 bg-slate-900/40 text-slate-400 text-sm space-y-2">
          <p>Mail is not enabled for your account yet.</p>
          <p>
            Ask an admin to set your company mailbox (email + password) on the Users page.
            Shared IMAP/SMTP hosts must be configured in{" "}
            <code className="text-slate-300">backend/.env</code> with{" "}
            <code className="text-slate-300">MAILBOX_ENABLED=true</code>.
          </p>
        </div>
      </section>
    );
  }

  async function createLabel() {
    const name = newLabelName.trim();
    if (!name) return;
    setCreatingLabel(true);
    try {
      const matchHint = newLabelDomain.trim() || name;
      await client.createMailLabel({
        name,
        // Domain optional — label name alone (e.g. LinkedIn) also routes matching mail.
        match_query: newLabelDomain.trim() || name,
      });
      setNewLabelName("");
      setNewLabelDomain("");
      setNotice(
        `Label “${name}” created — mail mentioning “${matchHint}” (from, subject, or preview) goes there instead of Inbox.`,
      );
      onMailExtrasChangeRef.current?.();
      await loadList({ silent: true });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to create label");
    } finally {
      setCreatingLabel(false);
    }
  }

  async function discardDraftById(draftId: number) {
    try {
      await client.deleteMailDraft(draftId);
      setNotice("Draft discarded.");
      if (composeDraft?.id === draftId) {
        setShowCompose(false);
        setComposeDraft(null);
      }
      onMailExtrasChangeRef.current?.();
      await loadList({ silent: true });
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to discard draft");
    }
  }

  async function assignLabelToCurrent(label: MailLabel, applySimilar: boolean) {
    const detail = messageDetail;
    const threadMsg = thread?.messages?.[thread.messages.length - 1];
    const target = detail || threadMsg;
    if (!target) {
      onError("Open a message first to apply a label");
      return;
    }
    setAssigningLabel(true);
    try {
      await client.assignMailLabel({
        label_id: label.id,
        folder: (target.folder || section || "inbox").toLowerCase(),
        message_uid: String(target.uid),
        message_id: target.message_id ?? null,
        thread_id: thread?.thread_id ?? null,
        from_email: target.from_email,
        subject: target.subject,
        apply_similar: applySimilar,
      });
      setNotice(
        applySimilar
          ? `Labeled “${label.name}” (including similar messages).`
          : `Labeled “${label.name}”.`,
      );
      setLabelMenuOpen(false);
      const mapped = await client.mapMailLabelsByUids(
        (target.folder || "inbox").toLowerCase(),
        [String(target.uid)],
      );
      setMessageLabels(mapped[String(target.uid)] || []);
      onMailExtrasChangeRef.current?.();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to assign label");
    } finally {
      setAssigningLabel(false);
    }
  }

  return (
    <section className="space-y-4 w-full min-w-0">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-medium text-slate-100">
            {sectionTitle(section, labels)}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {sectionDescription(section, status?.email)}
            {section === "inbox" && status ? ` · ${status.unread_count} unread` : ""}
          </p>
          {isLabelView && labels.find((l) => l.id === labelId) ? (
            <p className="text-xs text-emerald-400/90 mt-1">
              Auto-routing:{" "}
              {labelMatchTokens(labels.find((l) => l.id === labelId)!).join(", ") ||
                labels.find((l) => l.id === labelId)?.name}
            </p>
          ) : null}
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
          <ActionButton
            icon={IconPlus}
            variant="primary"
            size="md"
            onClick={() => {
              // Localhost: in-app compose logs Email Activity to this backend.
              // Live: open Vercel mailer (SMTP off Railway Hobby).
              if (onOpenMailerCompose && !import.meta.env.DEV) {
                onOpenMailerCompose();
                return;
              }
              setComposeDraft(null);
              setShowCompose(true);
            }}
            title="Compose"
          >
            Compose
          </ActionButton>
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void createLabel();
            }}
          >
            <input
              type="text"
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value)}
              placeholder="Label name"
              className="w-32 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-slate-100 placeholder:text-slate-600"
            />
            <input
              type="text"
              value={newLabelDomain}
              onChange={(e) => setNewLabelDomain(e.target.value)}
              placeholder="Keyword / domain (optional)"
              title="e.g. linkedin or linkedin.com — leave blank to use the label name"
              className="w-44 sm:w-52 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-2 text-sm text-slate-100 placeholder:text-slate-600"
            />
            <ActionButton
              icon={IconTag}
              type="submit"
              size="md"
              disabled={creatingLabel || !newLabelName.trim()}
              title="Create label — matching mail leaves Inbox"
            >
              {creatingLabel ? "…" : "Create label"}
            </ActionButton>
          </form>
          {section === "trash" && (
            <ActionButton
              icon={IconTrash}
              variant="danger"
              size="md"
              onClick={() => void handleEmptyTrash()}
              disabled={emptyingTrash || messages.length === 0}
              title="Empty Trash"
            >
              {emptyingTrash ? "Emptying…" : "Empty Trash"}
            </ActionButton>
          )}
          {section === "inbox" && (
            <ActionButton
              icon={IconFilter}
              size="md"
              onClick={() => void resetCutoff()}
              title="Hide mail received before right now"
            >
              New mail only
            </ActionButton>
          )}
          {isFolderMail && section !== "sent" && !isDraftsView && (
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
          <ActionButton
            icon={IconRefresh}
            size="md"
            onClick={() => void loadList()}
            title="Refresh"
          >
            Refresh
          </ActionButton>
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

      {notice && !showReplyForm && !showCompose && (
        <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(320px,440px)_1fr] gap-4 xl:gap-6">
        <div
          className={`rounded-xl border border-slate-800 overflow-hidden bg-slate-950/40 ${
            selectedThreadId || selectedMessageKey || (isDraftsView && composeDraft)
              ? "hidden lg:block"
              : ""
          }`}
        >
          <div className="max-h-[75vh] overflow-y-auto divide-y divide-slate-800/80">
            {loading ? (
              <p className="py-10 text-center text-slate-500 text-sm">
                {isDraftsView
                  ? "Loading drafts…"
                  : isThreadView
                    ? "Loading conversations…"
                    : "Loading messages…"}
              </p>
            ) : isDraftsView ? (
              drafts.length === 0 ? (
                <p className="py-10 text-center text-slate-500 text-sm">{emptyListMessage(section)}</p>
              ) : (
                drafts.map((draft) => (
                  <div
                    key={draft.id}
                    className="flex items-stretch gap-1 hover:bg-slate-900/60 transition"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setComposeDraft(draft);
                        setShowCompose(true);
                      }}
                      className="min-w-0 flex-1 text-left px-4 py-3.5"
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-slate-100">
                          {draft.to_addrs || "(no recipient)"}
                        </span>
                        <span className="ml-auto shrink-0 text-[11px] text-slate-500">
                          {formatDate(draft.updated_at)}
                        </span>
                      </div>
                      <div className="truncate text-sm text-slate-300 mt-0.5">
                        {draft.subject || "(no subject)"}
                      </div>
                      <div className="truncate text-xs text-slate-500 mt-1">
                        {(draft.body || "").replace(/\s+/g, " ").slice(0, 120)}
                      </div>
                    </button>
                    <button
                      type="button"
                      title="Discard draft"
                      onClick={() => void discardDraftById(draft.id)}
                      className="shrink-0 self-center mr-3 px-2.5 py-1.5 rounded-lg border border-red-800/40 text-red-300 text-xs hover:bg-red-950/40"
                    >
                      Discard
                    </button>
                  </div>
                ))
              )
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

        <div
          className={`rounded-xl border border-slate-800 min-h-[50vh] flex-col bg-slate-950/30 ${
            selectedThreadId || selectedMessageKey ? "flex" : "hidden lg:flex"
          }`}
        >
              <div className="lg:hidden px-4 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedThreadId(null);
                    setSelectedMessageKey(null);
                  }}
                  className="text-sm text-slate-400 hover:text-slate-200"
                >
                  ← Back to list
                </button>
              </div>
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
                    <div className="flex flex-wrap gap-2 items-center">
                      {messageLabels.map((label) => (
                        <span
                          key={label.id}
                          className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border"
                          style={{
                            color: label.color,
                            borderColor: `${label.color}66`,
                            backgroundColor: `${label.color}22`,
                          }}
                        >
                          {label.name}
                        </span>
                      ))}
                      <div className="relative">
                        <button
                          type="button"
                          onClick={() => setLabelMenuOpen((open) => !open)}
                          disabled={assigningLabel || labels.length === 0}
                          className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-sm hover:bg-slate-900 disabled:opacity-50"
                        >
                          Labels
                        </button>
                        {labelMenuOpen && (
                          <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-700 bg-slate-900 shadow-xl py-1">
                            {labels.map((label) => (
                              <div key={label.id} className="px-2 py-1">
                                <button
                                  type="button"
                                  onClick={() => void assignLabelToCurrent(label, false)}
                                  className="w-full text-left px-2 py-1.5 rounded text-sm text-slate-200 hover:bg-slate-800"
                                >
                                  {label.name}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void assignLabelToCurrent(label, true)}
                                  className="w-full text-left px-2 py-1 text-[11px] text-slate-500 hover:text-emerald-300"
                                >
                                  + similar messages
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <ActionButton
                        icon={IconArchive}
                        onClick={() => void moveThread("archive")}
                        disabled={moving}
                        title="Archive"
                      >
                        Archive
                      </ActionButton>
                      <ActionButton
                        icon={IconTrash}
                        variant="rose"
                        onClick={() => void moveThread("trash")}
                        disabled={moving}
                        title="Move to Trash"
                      >
                        Trash
                      </ActionButton>
                      {!showReplyForm && (
                        <>
                          <ActionButton
                            icon={aiAnalysis?.draft_reply ? IconSparkles : IconReply}
                            variant="primary"
                            onClick={() => startReply("reply")}
                            title={
                              aiAnalysis?.draft_reply
                                ? "Use AI draft (reply to sender only)"
                                : "Reply to sender only"
                            }
                          >
                            {aiAnalysis?.draft_reply ? "AI draft" : "Reply"}
                          </ActionButton>
                          {canReplyAll && (
                            <ActionButton
                              icon={IconReply}
                              onClick={() => startReply("reply_all")}
                              title="Reply all — sender plus To/Cc/Bcc"
                            >
                              Reply all
                            </ActionButton>
                          )}
                        </>
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
                          <ActionButton
                            icon={IconRefresh}
                            size="sm"
                            onClick={() => void runThreadAnalyze(selectedThreadId)}
                            disabled={aiLoading}
                            title="Refresh analysis"
                            className="border-sky-500/40 text-sky-200"
                          >
                            Refresh analysis
                          </ActionButton>
                        )}
                        {aiAnalysis?.draft_reply && !showReplyForm && (
                          <ActionButton
                            icon={IconSparkles}
                            variant="primary"
                            size="sm"
                            onClick={() => applyAiDraftToReplyForm(aiAnalysis)}
                            title="Edit and send draft"
                          >
                            Edit &amp; send
                          </ActionButton>
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
                          className={`max-w-[98%] xl:max-w-5xl w-full rounded-2xl border px-5 py-4 ${
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
                    <EmailBodyEditor
                      value={replyBody}
                      onChange={setReplyBody}
                      placeholder="Edit the AI draft or write your reply…"
                      rows={7}
                    />
                    <div className="flex justify-end gap-2">
                      <ActionButton
                        icon={IconX}
                        size="md"
                        onClick={() => {
                          setShowReplyForm(false);
                          setReplyBody("");
                          setNotice(null);
                        }}
                        title="Cancel"
                      >
                        Cancel
                      </ActionButton>
                      <ActionButton
                        icon={IconSend}
                        variant="primary"
                        size="md"
                        onClick={() => void sendReply()}
                        disabled={
                          sending || !emailBodyHasContent(replyBody) || !replyTo.trim()
                        }
                        title="Send reply"
                      >
                        {sending ? "Sending…" : "Send reply"}
                      </ActionButton>
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
              {isDraftsView
                ? "Select a draft to continue editing."
                : "Select a message to read it."}
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
                  <div className="flex flex-wrap gap-2 items-center">
                    {messageLabels.map((label) => (
                      <span
                        key={label.id}
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium border"
                        style={{
                          color: label.color,
                          borderColor: `${label.color}66`,
                          backgroundColor: `${label.color}22`,
                        }}
                      >
                        {label.name}
                      </span>
                    ))}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setLabelMenuOpen((open) => !open)}
                        disabled={assigningLabel || labels.length === 0}
                        className="shrink-0 px-3 py-1.5 rounded-lg border border-slate-700 text-slate-300 text-sm hover:bg-slate-900 disabled:opacity-50"
                      >
                        Labels
                      </button>
                      {labelMenuOpen && (
                        <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-700 bg-slate-900 shadow-xl py-1">
                          {labels.map((label) => (
                            <div key={label.id} className="px-2 py-1">
                              <button
                                type="button"
                                onClick={() => void assignLabelToCurrent(label, false)}
                                className="w-full text-left px-2 py-1.5 rounded text-sm text-slate-200 hover:bg-slate-800"
                              >
                                {label.name}
                              </button>
                              <button
                                type="button"
                                onClick={() => void assignLabelToCurrent(label, true)}
                                className="w-full text-left px-2 py-1 text-[11px] text-slate-500 hover:text-emerald-300"
                              >
                                + similar messages
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    {(section === "trash" || section === "archive") && (
                      <ActionButton
                        icon={IconInbox}
                        onClick={() => void moveSelectedMessage("inbox")}
                        disabled={moving}
                        title="Restore to Inbox"
                      >
                        Restore
                      </ActionButton>
                    )}
                    {section === "archive" && (
                      <ActionButton
                        icon={IconTrash}
                        variant="rose"
                        onClick={() => void moveSelectedMessage("trash")}
                        disabled={moving}
                        title="Move to Trash"
                      >
                        Trash
                      </ActionButton>
                    )}
                    {section === "sent" && (
                      <>
                        <ActionButton
                          icon={IconArchive}
                          onClick={() => void moveSelectedMessage("archive")}
                          disabled={moving}
                          title="Archive"
                        >
                          Archive
                        </ActionButton>
                        <ActionButton
                          icon={IconTrash}
                          variant="rose"
                          onClick={() => void moveSelectedMessage("trash")}
                          disabled={moving}
                          title="Move to Trash"
                        >
                          Trash
                        </ActionButton>
                      </>
                    )}
                    {section !== "sent" && !showReplyForm && (
                      <>
                        <ActionButton
                          icon={aiAnalysis?.draft_reply ? IconSparkles : IconReply}
                          variant="primary"
                          onClick={() => startReply("reply")}
                          title={
                            aiAnalysis?.draft_reply
                              ? "Use AI draft (reply to sender only)"
                              : "Reply to sender only"
                          }
                        >
                          {aiAnalysis?.draft_reply ? "AI draft" : "Reply"}
                        </ActionButton>
                        {canReplyAll && (
                          <ActionButton
                            icon={IconReply}
                            onClick={() => startReply("reply_all")}
                            title="Reply all — sender plus To/Cc/Bcc"
                          >
                            Reply all
                          </ActionButton>
                        )}
                      </>
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
                <div className="rounded-2xl border border-slate-700 bg-slate-900/80 px-5 py-4 max-w-5xl">
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
                  <EmailBodyEditor
                    value={replyBody}
                    onChange={setReplyBody}
                    placeholder="Edit the AI draft, then send…"
                    rows={7}
                  />
                  <div className="flex justify-end gap-2">
                    <ActionButton
                      icon={IconX}
                      size="md"
                      onClick={() => {
                        setShowReplyForm(false);
                        setReplyBody("");
                        setNotice(null);
                      }}
                      title="Cancel"
                    >
                      Cancel
                    </ActionButton>
                    <ActionButton
                      icon={IconSend}
                      variant="primary"
                      size="md"
                      onClick={() => void sendReply()}
                      disabled={
                        sending || !emailBodyHasContent(replyBody) || !replyTo.trim()
                      }
                      title="Send reply"
                    >
                      {sending ? "Sending…" : "Send reply"}
                    </ActionButton>
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

      {showCompose && (
        <ComposeMailModal
          fromEmail={status?.email || status?.emails?.[0] || "Your mailbox"}
          initialDraft={composeDraft}
          onClose={() => {
            setShowCompose(false);
            setComposeDraft(null);
            if (isDraftsView) void loadList({ silent: true });
          }}
          onDraftSaved={() => {
            onMailExtrasChangeRef.current?.();
            if (isDraftsView) void loadList({ silent: true });
          }}
          onDraftDiscarded={() => {
            setNotice("Draft discarded.");
            onMailExtrasChangeRef.current?.();
            void loadList({ silent: true });
          }}
          onSent={(message) => {
            setNotice(message);
            setComposeDraft(null);
            void loadList({ silent: true });
            void refreshFolderCounts();
            onMailExtrasChangeRef.current?.();
          }}
          onError={onError}
        />
      )}
    </section>
  );
}
