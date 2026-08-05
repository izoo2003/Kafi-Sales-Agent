import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  client,
  type ClientHistoryDetailEntry,
  type ClientHistoryDetailResponse,
} from "../api/client";
import { autocorrectText, spellingInputProps } from "../utils/spelling";

interface ClientHistoryPanelProps {
  buyerId: number;
  companyName: string;
  onError: (message: string) => void;
  /** Called after remarks are saved so parent views (e.g. table) can refresh. */
  onRemarksSaved?: (remarks: string) => void;
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function RemarksHistoryList({
  entries,
  emptyLabel = "No earlier remarks yet.",
}: {
  entries: ClientHistoryDetailEntry[];
  emptyLabel?: string;
}) {
  // Newest first for a change log.
  const rows = useMemo(
    () =>
      [...entries]
        .filter((entry) => (entry.text || "").trim())
        .reverse(),
    [entries],
  );

  if (rows.length === 0) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
      {rows.map((entry, idx) => (
        <div
          key={`${entry.at}-${idx}`}
          className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5"
        >
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 mb-1.5">
            <span className="font-medium text-slate-300">
              {formatWhen(entry.at)}
            </span>
            {entry.by ? <span>· {entry.by}</span> : null}
            {entry.source === "call" ? (
              <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                From call
              </span>
            ) : null}
            {entry.current ? (
              <span className="rounded-full border border-emerald-800/60 text-emerald-400/90 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                Current
              </span>
            ) : null}
          </div>
          <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">
            {entry.text}
          </p>
        </div>
      ))}
    </div>
  );
}

export function ClientHistoryPanel({
  buyerId,
  companyName,
  onError,
  onRemarksSaved,
}: ClientHistoryPanelProps) {
  const [detail, setDetail] = useState<ClientHistoryDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await client.getClientHistory(buyerId);
      setDetail(next);
      setNote(next.remarks || "");
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load client remarks");
    } finally {
      setLoading(false);
    }
  }, [buyerId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setHistoryOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [historyOpen]);

  const dirty = useMemo(() => {
    const current = (detail?.remarks || "").trim();
    return autocorrectText(note, "prose").trim() !== current;
  }, [detail?.remarks, note]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const text = autocorrectText(note, "prose");
    if (!text) return;
    if (!dirty) return;
    setSaving(true);
    try {
      const next = await client.addClientHistoryRemark(buyerId, { text });
      setDetail(next);
      setNote(next.remarks || text);
      onRemarksSaved?.(next.remarks || text);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save remark");
    } finally {
      setSaving(false);
    }
  }

  const entries = detail?.entries || [];
  const historyCount = entries.filter((e) => (e.text || "").trim()).length;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-slate-100">Client remarks</h3>
          <p className="text-xs text-slate-500 mt-1">
            One remarks box for {companyName}. Save to update it — every change is kept in history.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className="shrink-0 rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
        >
          History{historyCount ? ` (${historyCount})` : ""}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading remarks…</p>
      ) : (
        <form onSubmit={(e) => void handleSave(e)} className="space-y-2">
          <label className="block text-xs text-slate-400" htmlFor={`client-remarks-${buyerId}`}>
            Remarks
          </label>
          <textarea
            id={`client-remarks-${buyerId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={(e) => setNote(autocorrectText(e.target.value, "prose"))}
            rows={4}
            placeholder="Notes about this client…"
            className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
            {...spellingInputProps("prose")}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-500">
              {detail?.remarks_updated_at ? (
                <>
                  Updated at {formatWhen(detail.remarks_updated_at)}
                  {detail.remarks_updated_by ? ` · ${detail.remarks_updated_by}` : ""}
                </>
              ) : detail?.remarks?.trim() ? (
                "Updated time not recorded yet"
              ) : (
                "No remarks saved yet"
              )}
            </p>
            <button
              type="submit"
              disabled={saving || !note.trim() || !dirty}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save remarks"}
            </button>
          </div>
        </form>
      )}

      {historyOpen &&
        createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60"
            onClick={() => setHistoryOpen(false)}
            role="presentation"
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Client remarks history"
              className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-3 border-b border-slate-800 px-4 py-3">
                <div>
                  <h3 className="text-sm font-medium text-slate-200">Remarks history</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{companyName}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryOpen(false)}
                  className="rounded-md px-2 py-1 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                >
                  Close
                </button>
              </div>
              <div className="px-4 py-4">
                <RemarksHistoryList entries={entries} />
              </div>
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}

export function sourceLabelForHistory(source: string | undefined) {
  return source === "call" ? "Call remarks" : "Client remarks";
}

export { RemarksHistoryList, formatWhen as formatClientHistoryWhen };
