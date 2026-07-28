"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useAuth } from "./AuthProvider";

export type MessageSummary = {
  uid: string;
  folder: string;
  subject: string;
  from_email?: string | null;
  from_name?: string | null;
  date?: string | null;
  preview?: string;
  unread?: boolean;
};

export type MessageDetail = MessageSummary & {
  body_text?: string | null;
  body_html?: string | null;
  to?: string[];
};

type Props = {
  folder: "inbox" | "sent" | "trash" | "archive";
};

export function FolderView({ folder }: Props) {
  const { token } = useAuth();
  const [messages, setMessages] = useState<MessageSummary[]>([]);
  const [selected, setSelected] = useState<MessageDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyOpen, setReplyOpen] = useState(false);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const rows = await apiFetch<MessageSummary[]>(
        `/inbox/messages?folder=${encodeURIComponent(folder)}&limit=50`,
      );
      setMessages(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load mail");
    } finally {
      setLoading(false);
    }
  }, [folder]);

  useEffect(() => {
    setSelected(null);
    setReplyOpen(false);
    void load();
  }, [load]);

  async function openMessage(row: MessageSummary) {
    setNotice(null);
    setReplyOpen(false);
    const folderKey = row.folder || folder;
    try {
      const detail = await apiFetch<MessageDetail>(
        `/inbox/messages/${encodeURIComponent(row.uid)}?folder=${encodeURIComponent(folderKey)}`,
      );
      setSelected(detail);
      if (detail.unread) {
        void apiFetch(
          `/inbox/messages/${encodeURIComponent(row.uid)}/read?folder=${encodeURIComponent(folderKey)}`,
          { method: "POST" },
        ).then(() => {
          setMessages((prev) =>
            prev.map((m) => (m.uid === row.uid ? { ...m, unread: false } : m)),
          );
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to open message");
    }
  }

  async function moveTo(dest: "trash" | "archive" | "inbox") {
    if (!selected) return;
    try {
      await apiFetch(`/inbox/messages/${encodeURIComponent(selected.uid)}/move`, {
        method: "POST",
        body: JSON.stringify({ from_folder: selected.folder || folder, to_folder: dest }),
      });
      setSelected(null);
      setNotice(`Moved to ${dest}`);
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Move failed");
    }
  }

  async function sendReply() {
    if (!selected || !token || !replyBody.trim()) return;
    const to = selected.from_email;
    if (!to) {
      setError("No reply address on this message");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auth_token: token,
          to,
          subject: selected.subject?.startsWith("Re:")
            ? selected.subject
            : `Re: ${selected.subject || ""}`,
          body: replyBody,
          html: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      setReplyOpen(false);
      setReplyBody("");
      setNotice("Reply sent via Vercel SMTP");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reply failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="folder-layout">
      <div className="folder-list">
        <div className="folder-list-head">
          <h2 className="folder-title">{folder}</h2>
          <button type="button" className="btn ghost small" onClick={() => void load()}>
            Refresh
          </button>
        </div>
        {loading && <p className="muted pad">Loading…</p>}
        {error && <p className="bad pad">{error}</p>}
        {notice && <p className="ok pad">{notice}</p>}
        <ul className="msg-list">
          {messages.map((m) => (
            <li key={m.uid}>
              <button
                type="button"
                className={`msg-row ${selected?.uid === m.uid ? "selected" : ""} ${m.unread ? "unread" : ""}`}
                onClick={() => void openMessage(m)}
              >
                <span className="msg-from">
                  {m.from_name || m.from_email || "(no sender)"}
                </span>
                <span className="msg-subject">{m.subject || "(no subject)"}</span>
                <span className="msg-preview muted">{m.preview}</span>
              </button>
            </li>
          ))}
          {!loading && messages.length === 0 && (
            <li className="muted pad">No messages</li>
          )}
        </ul>
      </div>
      <div className="folder-detail">
        {!selected ? (
          <p className="muted pad">Select a message</p>
        ) : (
          <div className="detail-card">
            <h3>{selected.subject || "(no subject)"}</h3>
            <p className="muted">
              From: {selected.from_name || selected.from_email}
              {selected.date ? ` · ${new Date(selected.date).toLocaleString()}` : ""}
            </p>
            <div className="detail-actions">
              {folder === "inbox" && (
                <button type="button" className="btn" onClick={() => setReplyOpen(true)}>
                  Reply
                </button>
              )}
              {folder !== "trash" && (
                <button type="button" className="btn ghost" onClick={() => void moveTo("trash")}>
                  Trash
                </button>
              )}
              {folder !== "archive" && (
                <button type="button" className="btn ghost" onClick={() => void moveTo("archive")}>
                  Archive
                </button>
              )}
              {folder !== "inbox" && (
                <button type="button" className="btn ghost" onClick={() => void moveTo("inbox")}>
                  Move to inbox
                </button>
              )}
            </div>
            {selected.body_html ? (
              <div
                className="detail-body"
                dangerouslySetInnerHTML={{ __html: selected.body_html }}
              />
            ) : (
              <div className="detail-body pre">
                {selected.body_text || selected.preview || ""}
              </div>
            )}
            {replyOpen && (
              <div className="reply-box">
                <label>Reply</label>
                <textarea
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Write your reply…"
                />
                <button
                  type="button"
                  className="btn"
                  disabled={sending || !replyBody.trim()}
                  onClick={() => void sendReply()}
                >
                  {sending ? "Sending…" : "Send reply"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
