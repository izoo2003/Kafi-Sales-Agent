import { useCallback, useEffect, useRef, useState } from "react";
import {
  client,
  type CallConfig,
  type CallHistoryItem,
  type LeadTableRow,
} from "../api/client";
import { CallLeadButton } from "../components/CallLeadButton";

interface CallsPageProps {
  onError: (message: string) => void;
  onSelectLead?: (leadId: number) => void;
}

const POLL_INTERVAL_MS = 15_000;

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
  if (value === "in-progress" || value === "ringing" || value === "answered" || value === "initiated") {
    return "bg-sky-500/15 text-sky-300 border-sky-500/30";
  }
  return "bg-slate-700/50 text-slate-300 border-slate-600";
}

export function CallsPage({ onError, onSelectLead }: CallsPageProps) {
  const [config, setConfig] = useState<CallConfig | null>(null);
  const [history, setHistory] = useState<CallHistoryItem[]>([]);
  const [dialableLeads, setDialableLeads] = useState<LeadTableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<number | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const pollRef = useRef<number | null>(null);

  const loadData = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!options?.silent) setLoading(true);
      try {
        const [cfg, calls, table] = await Promise.all([
          client.getCallConfig(),
          client.listCallHistory(50),
          client.listLeadsTable(),
        ]);
        setConfig(cfg);
        setHistory(calls);
        setDialableLeads(
          table.rows.filter((row) => row.contact_phone && row.contact_phone.trim()),
        );
      } catch (e) {
        if (!options?.silent) {
          onError(e instanceof Error ? e.message : "Failed to load calls");
        }
      } finally {
        if (!options?.silent) setLoading(false);
      }
    },
    [onError],
  );

  useEffect(() => {
    void loadData();
  }, [loadData]);

  useEffect(() => {
    if (!config?.configured) return;
    pollRef.current = window.setInterval(() => {
      void loadData({ silent: true });
    }, POLL_INTERVAL_MS);
    return () => {
      if (pollRef.current !== null) window.clearInterval(pollRef.current);
    };
  }, [config?.configured, loadData]);

  const selectedCall = history.find((c) => c.id === selectedCallId) ?? null;

  async function saveNotes() {
    if (!selectedCallId) return;
    setSavingNotes(true);
    try {
      const updated = await client.updateCallNotes(selectedCallId, notesDraft);
      setHistory((prev) => prev.map((c) => (c.id === selectedCallId ? updated : c)));
      setNotice("Notes saved.");
      setTimeout(() => setNotice(null), 3000);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save notes");
    } finally {
      setSavingNotes(false);
    }
  }

  if (!loading && config && !config.configured) {
    return (
      <section className="space-y-4">
        <h2 className="text-lg font-medium text-slate-100">Calls</h2>
        <div className="p-6 rounded-xl border border-amber-800/50 bg-amber-900/20 text-amber-100 text-sm space-y-3">
          <p className="font-medium">Twilio not connected yet.</p>
          <p className="text-amber-200/80">
            Call clients <strong>directly from your browser</strong> — no personal phone number
            needed. Human-initiated only (click to call).
          </p>
          <p className="text-amber-200/80 text-xs">
            1. Twilio account + Voice number
            <br />
            2. Create API Key + TwiML App (see backend/.env.example)
            <br />
            3. <code className="text-amber-100">ngrok http 8000</code> for local dev
            <br />
            4. Restart backend
          </p>
          <pre className="mt-2 p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-xs text-slate-300 overflow-x-auto">
{`TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=your_token
TWILIO_PHONE_NUMBER=+1234567890
TWILIO_API_KEY_SID=SKxxxxxxxx
TWILIO_API_KEY_SECRET=your_secret
TWILIO_TWIML_APP_SID=APxxxxxxxx
TWILIO_WEBHOOK_BASE_URL=https://abc123.ngrok-free.app`}
          </pre>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-medium text-slate-100">Calls</h2>
          <p className="text-sm text-slate-500 mt-1">
            Browser calling via Twilio
            {config?.caller_id_masked ? ` · Caller ID ${config.caller_id_masked}` : ""}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          className="px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-sm"
        >
          Refresh
        </button>
      </div>

      {config?.setup_message && (
        <div className="p-4 rounded-xl border border-amber-800/50 bg-amber-900/20 text-amber-100 text-sm">
          {config.setup_message}
        </div>
      )}

      {notice && (
        <p className="text-sm text-emerald-300/90 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          {notice}
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 min-h-[480px]">
        <div className="lg:col-span-1 rounded-xl border border-slate-800 bg-slate-900 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <h3 className="text-sm font-medium text-slate-300">Quick dial</h3>
            <p className="text-xs text-slate-500 mt-1">Uses your browser mic &amp; speakers</p>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80">
            {dialableLeads.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">No leads with phone numbers yet.</p>
            ) : (
              dialableLeads.slice(0, 40).map((lead) => (
                <div key={lead.id} className="px-4 py-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectLead?.(lead.id)}
                    className="text-left min-w-0 flex-1"
                  >
                    <p className="text-sm text-slate-200 truncate">{lead.company_name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {lead.contact_name ?? "Contact"} · {lead.contact_phone}
                    </p>
                  </button>
                  <CallLeadButton
                    leadId={lead.id}
                    phone={lead.contact_phone}
                    compact
                    onError={onError}
                    onSuccess={(result) => {
                      setNotice(result.message ?? "Connected — speak through your browser.");
                      void loadData({ silent: true });
                    }}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-1 rounded-xl border border-slate-800 bg-slate-900 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800">
            <h3 className="text-sm font-medium text-slate-300">Recent calls</h3>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80">
            {history.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">No calls yet.</p>
            ) : (
              history.map((call) => (
                <button
                  key={call.id}
                  type="button"
                  onClick={() => {
                    setSelectedCallId(call.id);
                    setNotesDraft(call.notes ?? "");
                  }}
                  className={`w-full text-left px-4 py-3 hover:bg-slate-800/50 transition ${
                    selectedCallId === call.id ? "bg-slate-800/70" : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm text-slate-200 truncate">
                        {call.company_name ?? call.contact_name ?? "Call"}
                      </p>
                      <p className="text-xs text-slate-500">{formatDate(call.created_at)}</p>
                    </div>
                    {call.call_status && (
                      <span
                        className={`shrink-0 text-xs px-2 py-0.5 rounded border ${statusBadge(call.call_status)}`}
                      >
                        {call.call_status}
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-1 rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-4">
          <h3 className="text-sm font-medium text-slate-300">Call detail</h3>
          {!selectedCall ? (
            <p className="text-sm text-slate-500">Select a call to view details and add notes.</p>
          ) : (
            <>
              <dl className="space-y-2 text-sm">
                <div>
                  <dt className="text-slate-500 text-xs">Lead</dt>
                  <dd className="text-slate-200">
                    {selectedCall.company_name ?? "—"}
                    {selectedCall.buyer_id && onSelectLead && (
                      <button
                        type="button"
                        onClick={() => onSelectLead(selectedCall.buyer_id!)}
                        className="ml-2 text-xs text-sky-400 hover:text-sky-300"
                      >
                        Open profile
                      </button>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500 text-xs">Contact</dt>
                  <dd className="text-slate-200">
                    {selectedCall.contact_name ?? "—"}
                    {(selectedCall.lead_phone ?? selectedCall.contact_phone) && (
                      <span className="text-slate-500">
                        {" "}
                        · {selectedCall.lead_phone ?? selectedCall.contact_phone}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-slate-500 text-xs">Status</dt>
                  <dd className="text-slate-200">
                    {selectedCall.call_status ?? "—"}
                    {selectedCall.call_duration_seconds
                      ? ` · ${formatDuration(selectedCall.call_duration_seconds)}`
                      : ""}
                  </dd>
                </div>
                {selectedCall.call_sid && (
                  <div>
                    <dt className="text-slate-500 text-xs">Twilio SID</dt>
                    <dd className="text-slate-400 text-xs font-mono break-all">{selectedCall.call_sid}</dd>
                  </div>
                )}
              </dl>
              <div className="space-y-2">
                <label className="text-xs text-slate-500">Post-call notes</label>
                <textarea
                  value={notesDraft}
                  onChange={(e) => setNotesDraft(e.target.value)}
                  rows={5}
                  placeholder="Products discussed, MOQ, follow-up date…"
                  className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
                />
                <button
                  type="button"
                  disabled={savingNotes}
                  onClick={() => void saveNotes()}
                  className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50"
                >
                  {savingNotes ? "Saving…" : "Save notes"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-600">
        How it works: click Call → allow microphone → talk to the client directly from your browser.
        They see your Twilio number as caller ID. All calls are logged here and on the lead profile.
      </p>
    </section>
  );
}
