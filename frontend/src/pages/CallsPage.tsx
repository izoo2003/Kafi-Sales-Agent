import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  client,
  type CallConfig,
  type CallHistoryItem,
  type LeadTableRow,
} from "../api/client";
import { CallLeadButton } from "../components/CallLeadButton";
import { CallManualDialer } from "../components/CallManualDialer";
import { CallRemarksForm } from "../components/CallRemarksForm";
import { CallRecordingPanel } from "../components/CallRecordingPanel";
import { CountrySelect } from "../components/CountrySelect";
import { type CallOutcome, callOutcomeBadge, callOutcomeLabel, callOutcomeListNotice } from "../utils/callOutcomes";
import { countryMatches } from "../data/countries";

interface CallsPageProps {
  onError: (message: string) => void;
  onSelectLead?: (leadId: number) => void;
  onCallFollowUpSaved?: (outcome: string | null | undefined) => void;
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

export function CallsPage({ onError, onSelectLead, onCallFollowUpSaved }: CallsPageProps) {
  const [config, setConfig] = useState<CallConfig | null>(null);
  const [history, setHistory] = useState<CallHistoryItem[]>([]);
  const [dialableLeads, setDialableLeads] = useState<LeadTableRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<number | null>(null);
  const [remarksDraft, setRemarksDraft] = useState("");
  const [outcomeDraft, setOutcomeDraft] = useState<CallOutcome | "">("");
  const [savingFollowUp, setSavingFollowUp] = useState(false);
  const [deletingCallId, setDeletingCallId] = useState<number | null>(null);
  const [countryFilter, setCountryFilter] = useState<string>("");
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

  const dialableCountries = useMemo(() => {
    const unique = new Set<string>();
    for (const lead of dialableLeads) {
      const country = lead.country?.trim();
      if (country) unique.add(country);
    }
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [dialableLeads]);

  const filteredDialableLeads = useMemo(() => {
    if (!countryFilter) return dialableLeads;
    return dialableLeads.filter((lead) => countryMatches(lead.country, countryFilter));
  }, [dialableLeads, countryFilter]);

  async function saveFollowUp() {
    if (!selectedCallId) return;
    setSavingFollowUp(true);
    try {
      const updated = await client.updateCallFollowUp(selectedCallId, {
        notes: remarksDraft,
        call_outcome: outcomeDraft || null,
      });
      setHistory((prev) => prev.map((c) => (c.id === selectedCallId ? updated : c)));
      onCallFollowUpSaved?.(updated.call_outcome);
      const outcomeNotice = callOutcomeListNotice(updated.call_outcome);
      setNotice(outcomeNotice ?? "Call remarks saved.");
      setTimeout(() => setNotice(null), 4000);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save call remarks");
    } finally {
      setSavingFollowUp(false);
    }
  }

  function selectCall(call: CallHistoryItem) {
    setSelectedCallId(call.id);
    setRemarksDraft(call.notes ?? "");
    setOutcomeDraft((call.call_outcome as CallOutcome | undefined) ?? "");
  }

  async function deleteCall(call: CallHistoryItem) {
    const label = call.company_name ?? call.contact_name ?? "this call";
    if (!window.confirm(`Delete call log for ${label}? This cannot be undone.`)) return;

    setDeletingCallId(call.id);
    try {
      await client.deleteCallLog(call.id);
      setHistory((prev) => prev.filter((c) => c.id !== call.id));
      if (selectedCallId === call.id) {
        setSelectedCallId(null);
        setRemarksDraft("");
        setOutcomeDraft("");
      }
      if (call.call_outcome) {
        onCallFollowUpSaved?.(null);
      }
      setNotice("Call log deleted.");
      setTimeout(() => setNotice(null), 4000);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to delete call log");
    } finally {
      setDeletingCallId(null);
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
            3. <code className="text-amber-100">ngrok http 8003</code> for local dev (match API_PORT)
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
        <div className="lg:col-span-1 flex flex-col gap-4 overflow-hidden">
          <CallManualDialer
            onError={onError}
            onSuccess={(result) => {
              setNotice(result.message ?? "Connected — speak through your browser.");
              void loadData({ silent: true });
            }}
          />

          <div className="rounded-xl border border-slate-800 bg-slate-900 flex flex-col overflow-hidden flex-1 min-h-0">
          <div className="px-4 py-3 border-b border-slate-800 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-medium text-slate-300">Quick dial</h3>
                <p className="text-xs text-slate-500 mt-1">Uses your browser mic &amp; speakers</p>
              </div>
              {countryFilter && (
                <button
                  type="button"
                  onClick={() => setCountryFilter("")}
                  className="shrink-0 text-xs text-sky-400 hover:text-sky-300"
                >
                  Clear
                </button>
              )}
            </div>
            <CountrySelect
              value={countryFilter}
              onChange={setCountryFilter}
              allowEmpty
              emptyLabel={`All countries (${dialableLeads.length})`}
            />
            {countryFilter && (
              <p className="text-xs text-slate-500">
                {filteredDialableLeads.length} lead
                {filteredDialableLeads.length === 1 ? "" : "s"} in {countryFilter}
                {dialableCountries.length > 0 &&
                  !dialableCountries.some((c) => countryMatches(c, countryFilter)) &&
                  " (no leads with this country yet)"}
              </p>
            )}
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-slate-800/80">
            {filteredDialableLeads.length === 0 ? (
              <p className="p-4 text-sm text-slate-500">
                {dialableLeads.length === 0
                  ? "No leads with phone numbers yet."
                  : `No leads with phone numbers in ${countryFilter}.`}
              </p>
            ) : (
              filteredDialableLeads.slice(0, 40).map((lead) => (
                <div key={lead.id} className="px-4 py-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onSelectLead?.(lead.id)}
                    className="text-left min-w-0 flex-1"
                  >
                    <p className="text-sm text-slate-200 truncate">{lead.company_name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {lead.contact_name ?? "Contact"} · {lead.contact_phone}
                      {lead.country ? ` · ${lead.country}` : ""}
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
                <div
                  key={call.id}
                  className={`flex items-stretch ${
                    selectedCallId === call.id ? "bg-slate-800/70" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => selectCall(call)}
                    className="flex-1 min-w-0 text-left px-4 py-3 hover:bg-slate-800/50 transition"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm text-slate-200 truncate">
                          {call.company_name ?? call.contact_name ?? "Call"}
                        </p>
                        <p className="text-xs text-slate-500">{formatDate(call.created_at)}</p>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        {call.call_outcome && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded border ${callOutcomeBadge(call.call_outcome)}`}
                          >
                            {callOutcomeLabel(call.call_outcome)}
                          </span>
                        )}
                        {call.call_status && (
                          <span
                            className={`text-xs px-2 py-0.5 rounded border ${statusBadge(call.call_status)}`}
                          >
                            {call.call_status}
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteCall(call)}
                    disabled={deletingCallId === call.id}
                    title="Delete call log"
                    className="shrink-0 px-3 text-xs text-red-300 hover:text-red-200 hover:bg-red-900/30 border-l border-slate-800/80 disabled:opacity-50"
                  >
                    {deletingCallId === call.id ? "…" : "Delete"}
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="lg:col-span-1 rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-4">
          <h3 className="text-sm font-medium text-slate-300">Call detail</h3>
          {!selectedCall ? (
            <p className="text-sm text-slate-500">
              Select a call to add remarks and label the client outcome.
            </p>
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
                <div>
                  <dt className="text-slate-500 text-xs">Outcome</dt>
                  <dd className="text-slate-200">
                    {selectedCall.call_outcome ? (
                      <span
                        className={`inline-flex text-xs px-2 py-0.5 rounded border ${callOutcomeBadge(selectedCall.call_outcome)}`}
                      >
                        {callOutcomeLabel(selectedCall.call_outcome)}
                      </span>
                    ) : (
                      "Not labeled yet"
                    )}
                  </dd>
                </div>
                {selectedCall.notes && (
                  <div>
                    <dt className="text-slate-500 text-xs">Saved remarks</dt>
                    <dd className="text-slate-300 text-sm whitespace-pre-wrap">{selectedCall.notes}</dd>
                  </div>
                )}
              </dl>
              <CallRecordingPanel
                call={selectedCall}
                onError={onError}
                onUpdated={(updated) => {
                  setHistory((prev) =>
                    prev.map((c) => (c.id === updated.id ? updated : c)),
                  );
                }}
              />
              <CallRemarksForm
                remarks={remarksDraft}
                outcome={outcomeDraft}
                onRemarksChange={setRemarksDraft}
                onOutcomeChange={setOutcomeDraft}
                onSave={() => void saveFollowUp()}
                saving={savingFollowUp}
                saveLabel="Save remarks"
              />
              <button
                type="button"
                onClick={() => void deleteCall(selectedCall)}
                disabled={deletingCallId === selectedCall.id}
                className="w-full px-3 py-2 rounded-lg bg-red-900/40 hover:bg-red-900/60 border border-red-800/50 text-sm text-red-200 disabled:opacity-50"
              >
                {deletingCallId === selectedCall.id ? "Deleting…" : "Delete call log"}
              </button>
            </>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-600">
        How it works: click Call → allow microphone → talk to the client directly from your browser.
        They see your Twilio number as caller ID. Calls are recorded automatically — play, download,
        and read closed captions (CC) in the call detail panel after the call ends.
      </p>
    </section>
  );
}
