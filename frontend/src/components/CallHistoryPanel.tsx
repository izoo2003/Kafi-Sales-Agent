import { useCallback, useEffect, useState } from "react";
import { client, type CallHistoryItem } from "../api/client";

interface CallHistoryPanelProps {
  leadId: number;
  onError: (message: string) => void;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds) return "";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins ? `${mins}m ${secs}s` : `${secs}s`;
}

function statusBadge(status: string | null | undefined): string {
  const value = (status ?? "").toLowerCase();
  if (value === "completed") return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  if (value === "busy" || value === "no-answer" || value === "failed" || value === "canceled") {
    return "bg-red-500/15 text-red-300 border-red-500/30";
  }
  if (value === "in-progress" || value === "ringing" || value === "answered") {
    return "bg-sky-500/15 text-sky-300 border-sky-500/30";
  }
  return "bg-slate-700/50 text-slate-300 border-slate-600";
}

export function CallHistoryPanel({ leadId, onError }: CallHistoryPanelProps) {
  const [calls, setCalls] = useState<CallHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const loadCalls = useCallback(async () => {
    setLoading(true);
    try {
      setCalls(await client.listLeadCalls(leadId));
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load call history");
    } finally {
      setLoading(false);
    }
  }, [leadId, onError]);

  useEffect(() => {
    void loadCalls();
  }, [loadCalls]);

  async function saveNotes(interactionId: number) {
    setSaving(true);
    try {
      const updated = await client.updateCallNotes(interactionId, notesDraft);
      setCalls((prev) => prev.map((c) => (c.id === interactionId ? updated : c)));
      setEditingId(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save notes");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-medium text-slate-300">Call history</h3>
        <p className="text-sm text-slate-500 mt-2">Loading…</p>
      </section>
    );
  }

  if (calls.length === 0) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-medium text-slate-300">Call history</h3>
        <p className="text-sm text-slate-500 mt-2">No calls logged yet. Use Call on a contact above.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium text-slate-300">Call history</h3>
        <button
          type="button"
          onClick={() => void loadCalls()}
          className="text-xs text-slate-400 hover:text-slate-200"
        >
          Refresh
        </button>
      </div>
      <ul className="space-y-3">
        {calls.map((call) => (
          <li key={call.id} className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm text-slate-200">
                  {call.contact_name ?? "Contact"}
                  {call.lead_phone || call.contact_phone ? (
                    <span className="text-slate-500"> · {call.lead_phone ?? call.contact_phone}</span>
                  ) : null}
                </p>
                <p className="text-xs text-slate-500">{formatDate(call.created_at)}</p>
              </div>
              {call.call_status && (
                <span
                  className={`text-xs px-2 py-0.5 rounded border ${statusBadge(call.call_status)}`}
                >
                  {call.call_status}
                  {call.call_duration_seconds
                    ? ` · ${formatDuration(call.call_duration_seconds)}`
                    : ""}
                </span>
              )}
            </div>
            {call.notes && editingId !== call.id && (
              <p className="text-sm text-slate-400 whitespace-pre-wrap">{call.notes}</p>
            )}
            {editingId === call.id ? (
              <div className="space-y-2">
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={3}
                  placeholder="Post-call notes — products discussed, follow-up, etc."
                  className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-slate-200"
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void saveNotes(call.id)}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50"
                  >
                    {saving ? "Saving…" : "Save notes"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditingId(call.id);
                  setNotesDraft(call.notes ?? "");
                }}
                className="text-xs text-sky-400 hover:text-sky-300"
              >
                {call.notes ? "Edit notes" : "Add notes"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
