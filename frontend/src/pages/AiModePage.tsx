import { useCallback, useEffect, useState } from "react";
import {
  client,
  type AiModeAutoReplyLogRow,
  type AiModeLifecycleRow,
  type AiModeSettings,
} from "../api/client";

interface AiModePageProps {
  onError: (message: string) => void;
}

type Panel = "auto-reply" | "lifecycle";

interface DraftFields {
  form_url: string;
  email_subject_template: string;
  email_body_template: string;
  whatsapp_body_template: string;
  keywordsText: string;
}

function draftFromSettings(data: AiModeSettings): DraftFields {
  return {
    form_url: data.form_url ?? "",
    email_subject_template: data.email_subject_template,
    email_body_template: data.email_body_template,
    whatsapp_body_template: data.whatsapp_body_template,
    keywordsText: (data.query_keywords || []).join(", "),
  };
}

function parseKeywords(text: string): string[] {
  return text
    .split(/[,;\n]+/)
    .map((k) => k.trim())
    .filter(Boolean);
}

export function AiModePage({ onError }: AiModePageProps) {
  const [panel, setPanel] = useState<Panel>("auto-reply");
  const [settings, setSettings] = useState<AiModeSettings | null>(null);
  const [draft, setDraft] = useState<DraftFields | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [logs, setLogs] = useState<AiModeAutoReplyLogRow[]>([]);

  const [lifecycleRows, setLifecycleRows] = useState<AiModeLifecycleRow[]>([]);
  const [pipeline, setPipeline] = useState<Record<string, number>>({});
  const [stages, setStages] = useState<Array<{ key: string; label: string }>>([]);
  const [stageFilter, setStageFilter] = useState("");
  const [lifecycleSearch, setLifecycleSearch] = useState("");
  const [lifecycleLoading, setLifecycleLoading] = useState(false);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    try {
      const data = await client.getAiModeSettings();
      setSettings(data);
      setDraft(draftFromSettings(data));
      setStages(data.lifecycle_stages || []);
      const logResult = await client.listAiModeAutoReplies(40);
      setLogs(logResult.rows || []);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load AI Mode");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  const loadLifecycle = useCallback(async () => {
    setLifecycleLoading(true);
    try {
      const data = await client.listAiModeLifecycle({
        stage: stageFilter || undefined,
        search: lifecycleSearch.trim() || undefined,
        limit: 100,
      });
      setLifecycleRows(data.rows || []);
      setPipeline(data.pipeline || {});
      setStages(data.stages || []);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load lifecycle");
    } finally {
      setLifecycleLoading(false);
    }
  }, [lifecycleSearch, onError, stageFilter]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  useEffect(() => {
    if (panel === "lifecycle") void loadLifecycle();
  }, [panel, loadLifecycle]);

  const draftDirty =
    !!settings &&
    !!draft &&
    (draft.form_url !== (settings.form_url ?? "") ||
      draft.email_subject_template !== settings.email_subject_template ||
      draft.email_body_template !== settings.email_body_template ||
      draft.whatsapp_body_template !== settings.whatsapp_body_template ||
      parseKeywords(draft.keywordsText).join("|") !==
        (settings.query_keywords || []).join("|"));

  async function saveChannelFlags(patch: {
    enabled?: boolean;
    email_auto_reply_enabled?: boolean;
    whatsapp_auto_reply_enabled?: boolean;
  }) {
    if (!settings) return;
    setSaving(true);
    setNotice(null);
    try {
      const next = await client.updateAiModeSettings(patch);
      setSettings(next);
      setNotice(
        next.enabled
          ? "AI Mode is ON — auto-replies are active."
          : "AI Mode is OFF.",
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save AI Mode settings");
    } finally {
      setSaving(false);
    }
  }

  async function saveDraftTemplates(): Promise<AiModeSettings | null> {
    if (!settings || !draft) return null;
    setSaving(true);
    setNotice(null);
    try {
      const next = await client.updateAiModeSettings({
        form_url: draft.form_url.trim() || null,
        email_subject_template: draft.email_subject_template,
        email_body_template: draft.email_body_template,
        whatsapp_body_template: draft.whatsapp_body_template,
        query_keywords: parseKeywords(draft.keywordsText),
      });
      setSettings(next);
      setDraft(draftFromSettings(next));
      setNotice("Templates, form URL, and keywords saved.");
      return next;
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save templates");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function runProcessNow() {
    setProcessing(true);
    setNotice(null);
    try {
      if (draftDirty) {
        const saved = await saveDraftTemplates();
        if (!saved) return;
      }
      const result = await client.processAiModeEmails();
      setNotice(
        result.enabled
          ? `Processed with saved templates · scanned ${result.processed} · replied ${result.replied} · skipped ${result.skipped}`
          : "Turn AI Mode on to process emails.",
      );
      const logResult = await client.listAiModeAutoReplies(40);
      setLogs(logResult.rows || []);
      await loadSettings();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to process emails");
    } finally {
      setProcessing(false);
    }
  }

  async function changeStage(row: AiModeLifecycleRow, stage: string) {
    try {
      await client.updateAiModeLifecycle(row.buyer_id, { stage });
      await loadLifecycle();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to update stage");
    }
  }

  if (loading || !settings || !draft) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-sm text-slate-400">
        Loading AI Mode…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-medium text-slate-100">AI Mode</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Turn this on when you leave for the day. While enabled, query emails in Inbox/Junk
            and WhatsApp inquiries get the auto-reply drafted below. Company lifecycle tracks
            each lead from New Lead through Won/Lost.
          </p>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void saveChannelFlags({ enabled: !settings.enabled })}
          className={`relative inline-flex h-10 w-[7.5rem] items-center rounded-full border px-1 transition-colors ${
            settings.enabled
              ? "bg-emerald-600/30 border-emerald-500/50"
              : "bg-slate-900 border-slate-700"
          }`}
          aria-pressed={settings.enabled}
          title={settings.enabled ? "Turn AI Mode off" : "Turn AI Mode on"}
        >
          <span
            className={`inline-flex h-8 w-8 items-center justify-center rounded-full text-[10px] font-semibold transition-transform ${
              settings.enabled
                ? "translate-x-[3.85rem] bg-emerald-500 text-slate-950"
                : "translate-x-0 bg-slate-600 text-slate-100"
            }`}
          >
            {settings.enabled ? "ON" : "OFF"}
          </span>
        </button>
      </div>

      {notice && (
        <p className="rounded-lg border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-300">
          {notice}
        </p>
      )}

      <div className="flex gap-2 border-b border-slate-800 pb-2">
        {(
          [
            ["auto-reply", "Auto-reply"],
            ["lifecycle", "Company lifecycle"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setPanel(id)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              panel === id
                ? "bg-slate-800 text-slate-100"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {panel === "auto-reply" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <h3 className="text-sm font-medium text-slate-200">Channels</h3>
            <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
              <span>Email auto-reply (Inbox + Junk)</span>
              <input
                type="checkbox"
                checked={settings.email_auto_reply_enabled}
                onChange={(e) =>
                  void saveChannelFlags({ email_auto_reply_enabled: e.target.checked })
                }
                className="rounded border-slate-600"
              />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm text-slate-300">
              <span>WhatsApp auto-reply (when connected)</span>
              <input
                type="checkbox"
                checked={settings.whatsapp_auto_reply_enabled}
                onChange={(e) =>
                  void saveChannelFlags({ whatsapp_auto_reply_enabled: e.target.checked })
                }
                className="rounded border-slate-600"
              />
            </label>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Form URL (optional)</label>
              <input
                value={draft.form_url}
                onChange={(e) => setDraft({ ...draft, form_url: e.target.value })}
                placeholder="https://forms.example.com/kafi-interest"
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                Query keywords (comma or newline separated)
              </label>
              <textarea
                value={draft.keywordsText}
                onChange={(e) => setDraft({ ...draft, keywordsText: e.target.value })}
                rows={3}
                placeholder="inquiry, quote, price, interested, meeting…"
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Only messages matching these keywords get an auto-reply.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                disabled={saving || !draftDirty}
                onClick={() => void saveDraftTemplates()}
                className="rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 px-3 py-2 text-sm font-medium"
              >
                {saving ? "Saving…" : draftDirty ? "Save templates" : "Saved"}
              </button>
              <button
                type="button"
                disabled={processing || saving || !settings.enabled}
                onClick={() => void runProcessNow()}
                className="rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-50 px-3 py-2 text-sm font-medium"
              >
                {processing ? "Processing…" : "Save & process mailbox"}
              </button>
            </div>
            {draftDirty && (
              <p className="text-xs text-amber-400/90">Unsaved template changes.</p>
            )}
            {settings.last_email_processed_at && (
              <p className="text-xs text-slate-500">
                Last email scan: {new Date(settings.last_email_processed_at).toLocaleString()}
              </p>
            )}
          </section>

          <section className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <h3 className="text-sm font-medium text-slate-200">Reply drafts</h3>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Email subject</label>
              <input
                value={draft.email_subject_template}
                onChange={(e) =>
                  setDraft({ ...draft, email_subject_template: e.target.value })
                }
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                Email body — placeholders: {"{name}"}, {"{form_clause}"}, {"{form_url}"}
              </label>
              <textarea
                value={draft.email_body_template}
                onChange={(e) =>
                  setDraft({ ...draft, email_body_template: e.target.value })
                }
                rows={8}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">
                WhatsApp body — same placeholders
              </label>
              <textarea
                value={draft.whatsapp_body_template}
                onChange={(e) =>
                  setDraft({ ...draft, whatsapp_body_template: e.target.value })
                }
                rows={6}
                className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200 font-mono"
              />
            </div>
            <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
              <p className="text-[11px] uppercase tracking-wide text-slate-500 mb-2">
                Preview (email body)
              </p>
              <pre className="whitespace-pre-wrap text-xs text-slate-300 font-sans">
                {draft.email_body_template
                  .replaceAll("{name}", "Sir/Madam")
                  .replaceAll(
                    "{form_clause}",
                    draft.form_url.trim()
                      ? `: ${draft.form_url.trim()}`
                      : " (link will be shared by our team)",
                  )
                  .replaceAll(
                    "{form_url}",
                    draft.form_url.trim() || "(form link)",
                  )}
              </pre>
            </div>
          </section>

          <section className="lg:col-span-2 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <h3 className="text-sm font-medium text-slate-200 mb-3">Recent auto-replies</h3>
            {logs.length === 0 ? (
              <p className="text-sm text-slate-500">No auto-replies yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-800">
                      <th className="py-2 pr-3">When</th>
                      <th className="py-2 pr-3">Channel</th>
                      <th className="py-2 pr-3">To</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2">Subject / preview</th>
                    </tr>
                  </thead>
                  <tbody>
                    {logs.map((row) => (
                      <tr key={row.id} className="border-b border-slate-800/60 text-slate-300 align-top">
                        <td className="py-2 pr-3 whitespace-nowrap text-slate-500">
                          {row.created_at
                            ? new Date(row.created_at).toLocaleString()
                            : "—"}
                        </td>
                        <td className="py-2 pr-3 capitalize">{row.channel}</td>
                        <td className="py-2 pr-3">{row.recipient || "—"}</td>
                        <td className="py-2 pr-3">
                          <span
                            className={
                              row.status === "sent"
                                ? "text-emerald-400"
                                : row.status === "error"
                                  ? "text-rose-400"
                                  : undefined
                            }
                          >
                            {row.status}
                          </span>
                          {row.status === "error" && row.detail ? (
                            <p className="mt-1 max-w-xs text-[11px] leading-snug text-rose-300/80 whitespace-normal">
                              {row.detail}
                            </p>
                          ) : null}
                        </td>
                        <td className="py-2 truncate max-w-md">
                          {row.subject || row.preview || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {panel === "lifecycle" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {stages.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStageFilter((prev) => (prev === s.key ? "" : s.key))}
                className={`rounded-lg border px-2.5 py-1 text-xs ${
                  stageFilter === s.key
                    ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                    : "border-slate-700 text-slate-400 hover:text-slate-200"
                }`}
              >
                {s.label}
                <span className="ml-1 text-slate-500">{pipeline[s.key] ?? 0}</span>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input
              value={lifecycleSearch}
              onChange={(e) => setLifecycleSearch(e.target.value)}
              placeholder="Search company…"
              className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-200"
            />
            <button
              type="button"
              onClick={() => void loadLifecycle()}
              className="rounded-lg bg-slate-800 hover:bg-slate-700 px-3 py-2 text-sm"
            >
              Refresh
            </button>
          </div>
          {lifecycleLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : lifecycleRows.length === 0 ? (
            <p className="text-sm text-slate-500">
              No lifecycle rows yet. Stages are created when you update a company here, or as
              leads move through the pipeline.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-800 bg-slate-950">
                    <th className="py-2 px-3">Company</th>
                    <th className="py-2 px-3">Stage</th>
                    <th className="py-2 px-3">Since</th>
                    <th className="py-2 px-3">History</th>
                  </tr>
                </thead>
                <tbody>
                  {lifecycleRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-800/60">
                      <td className="py-2 px-3 text-slate-200">
                        <div>{row.company_name}</div>
                        <div className="text-xs text-slate-500">{row.country || "—"}</div>
                      </td>
                      <td className="py-2 px-3">
                        <select
                          value={row.stage}
                          onChange={(e) => void changeStage(row, e.target.value)}
                          className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-slate-200"
                        >
                          {stages.map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="py-2 px-3 text-slate-500 whitespace-nowrap">
                        {row.stage_entered_at
                          ? new Date(row.stage_entered_at).toLocaleString()
                          : "—"}
                      </td>
                      <td className="py-2 px-3 text-xs text-slate-500 max-w-sm">
                        {(row.history || [])
                          .slice(-4)
                          .map((h) => {
                            const label =
                              stages.find((s) => s.key === h.stage)?.label || h.stage;
                            return `${label} · ${new Date(h.at).toLocaleDateString()}`;
                          })
                          .join(" → ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
