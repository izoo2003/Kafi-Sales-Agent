import { useCallback, useEffect, useState } from "react";
import {
  client,
  type ClientHistoryDetailResponse,
} from "../api/client";
import { autocorrectText, spellingInputProps } from "../utils/spelling";

interface ClientHistoryPanelProps {
  buyerId: number;
  companyName: string;
  onError: (message: string) => void;
}

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function ClientHistoryPanel({
  buyerId,
  companyName,
  onError,
}: ClientHistoryPanelProps) {
  const [detail, setDetail] = useState<ClientHistoryDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDetail(await client.getClientHistory(buyerId));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load client history");
    } finally {
      setLoading(false);
    }
  }, [buyerId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAddRemark(e: React.FormEvent) {
    e.preventDefault();
    const text = autocorrectText(note, "prose");
    if (!text) return;
    setSaving(true);
    try {
      setDetail(await client.addClientHistoryRemark(buyerId, { text }));
      setNote("");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to save remark");
    } finally {
      setSaving(false);
    }
  }

  // Oldest → newest (Client Remarks # 1 at top, newest at bottom).
  const entries = (detail?.entries || []).filter((entry) => (entry.text || "").trim());

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 space-y-4">
      <div>
        <h3 className="text-sm font-medium text-slate-100">Client history</h3>
        <p className="text-xs text-slate-500 mt-1">
          Remarks for {companyName} — Client Remarks # 1 at the top, newer entries added below.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">Loading history…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-slate-500">No remarks recorded yet for this client.</p>
      ) : (
        <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
          {entries.map((entry, idx) => (
            <div
              key={`${entry.at}-${idx}`}
              className="rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2.5"
            >
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 mb-1.5">
                <span className="font-medium text-slate-300">
                  Client Remarks # {idx + 1}
                </span>
                <span>· {formatWhen(entry.at)}</span>
                {entry.by ? <span>· {entry.by}</span> : null}
                {entry.source === "call" ? (
                  <span className="rounded-full border border-slate-700 px-2 py-0.5 text-[10px] uppercase tracking-wide">
                    From call
                  </span>
                ) : null}
              </div>
              <p className="text-sm text-slate-200 whitespace-pre-wrap break-words">{entry.text}</p>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={(e) => void handleAddRemark(e)} className="space-y-2 border-t border-slate-800 pt-4">
        <label className="block text-xs text-slate-400" htmlFor={`client-history-${buyerId}`}>
          Add Client Remarks # {entries.length + 1}
        </label>
        <textarea
          id={`client-history-${buyerId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={(e) => setNote(autocorrectText(e.target.value, "prose"))}
          rows={3}
          placeholder="Note about this client…"
          className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600"
          {...spellingInputProps("prose")}
        />
        <button
          type="submit"
          disabled={saving || !note.trim()}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save to history"}
        </button>
      </form>
    </section>
  );
}

export function sourceLabelForHistory(source: string | undefined) {
  return source === "call" ? "Call remarks" : "Client remarks";
}
