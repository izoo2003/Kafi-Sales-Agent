import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { client } from "../api/client";

interface ComposeMailModalProps {
  fromEmail: string;
  onClose: () => void;
  onSent: (message: string) => void;
  onError: (message: string) => void;
}

export function ComposeMailModal({
  fromEmail,
  onClose,
  onSent,
  onError,
}: ComposeMailModalProps) {
  const titleId = useId();
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [showCc, setShowCc] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !sending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, sending]);

  async function handleSend() {
    const recipient = to.trim();
    if (!recipient || !recipient.includes("@")) {
      onError("Enter a valid To: email address");
      return;
    }
    if (!body.trim()) {
      onError("Email body cannot be empty");
      return;
    }
    setSending(true);
    try {
      const result = await client.composeInboxMail({
        to: recipient,
        subject: subject.trim(),
        body: body.trimEnd(),
        cc: cc.trim() || undefined,
      });
      onSent(
        `Sent to ${result.to || recipient}` +
          (result.subject ? ` — ${result.subject}` : ""),
      );
      onClose();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to send email");
    } finally {
      setSending(false);
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !sending) onClose();
      }}
    >
      <div className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-800">
          <h3 id={titleId} className="text-base font-medium text-slate-100">
            Compose mail
          </h3>
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="text-slate-400 hover:text-slate-200 text-sm disabled:opacity-50"
          >
            Close
          </button>
        </div>

        <div className="px-4 py-3 space-y-3">
          <label className="block space-y-1">
            <span className="text-xs text-slate-500">From</span>
            <input
              type="text"
              value={fromEmail}
              readOnly
              className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-300"
            />
          </label>

          <label className="block space-y-1">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500">To</span>
              {!showCc && (
                <button
                  type="button"
                  onClick={() => setShowCc(true)}
                  className="text-xs text-emerald-400 hover:text-emerald-300"
                >
                  Add Cc
                </button>
              )}
            </div>
            <input
              type="email"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="recipient@example.com"
              autoFocus
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
            />
          </label>

          {showCc && (
            <label className="block space-y-1">
              <span className="text-xs text-slate-500">Cc</span>
              <input
                type="email"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
                placeholder="optional@example.com"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
              />
            </label>
          )}

          <label className="block space-y-1">
            <span className="text-xs text-slate-500">Subject</span>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-600"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs text-slate-500">Message</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              placeholder="Write your email…"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-emerald-600 resize-y min-h-[180px]"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-slate-800 bg-slate-950/40">
          <button
            type="button"
            onClick={onClose}
            disabled={sending}
            className="px-3 py-2 rounded-lg border border-slate-700 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={sending || !to.trim() || !body.trim()}
            className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium text-white disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
