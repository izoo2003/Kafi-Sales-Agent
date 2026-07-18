import { useCallback, useEffect, useState } from "react";
import { client, type WhatsAppConfig, type WhatsAppTemplate } from "../api/client";

interface WhatsAppTemplatesPageProps {
  onError: (message: string) => void;
  onCountChange?: (count: number) => void;
}

const STATUS_STYLES: Record<string, string> = {
  approved: "bg-emerald-500/10 border-emerald-500/30 text-emerald-300",
  pending: "bg-amber-500/10 border-amber-500/30 text-amber-300",
  rejected: "bg-red-500/10 border-red-500/30 text-red-300",
  paused: "bg-slate-700/50 border-slate-600 text-slate-400",
  disabled: "bg-slate-700/50 border-slate-600 text-slate-400",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`px-2 py-0.5 rounded text-xs border ${STATUS_STYLES[status] ?? STATUS_STYLES.pending}`}
    >
      {status}
    </span>
  );
}

export function WhatsAppTemplatesPage({ onError, onCountChange }: WhatsAppTemplatesPageProps) {
  const [config, setConfig] = useState<WhatsAppConfig | null>(null);
  const [templates, setTemplates] = useState<WhatsAppTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [cfg, rows] = await Promise.all([
        client.getWhatsAppConfig(),
        client.listWhatsAppTemplates(),
      ]);
      setConfig(cfg);
      setTemplates(rows);
      onCountChange?.(rows.filter((t) => t.status === "approved").length);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load WhatsApp templates");
    } finally {
      setLoading(false);
    }
  }, [onCountChange, onError]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleSync() {
    setSyncing(true);
    setNotice(null);
    try {
      const result = await client.syncWhatsAppTemplates();
      setNotice(result.message);
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Template sync failed");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-medium text-slate-100">WhatsApp templates</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Templates are authored and approved in Meta Business Manager — this page mirrors
            their current status so you can pick one for a bulk campaign. Click{" "}
            <strong className="text-slate-300">Sync from Meta</strong> after creating or updating
            templates there.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={syncing || !config?.configured}
          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50 shrink-0"
        >
          {syncing ? "Syncing…" : "Sync from Meta"}
        </button>
      </div>

      {config && !config.configured && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <p className="font-medium">WhatsApp Cloud API is not configured yet.</p>
          <p className="mt-1 text-amber-200/80">
            Set {config.missing_env.join(", ")} in <code>backend/.env</code>, then restart the
            backend.
          </p>
        </div>
      )}

      {notice && (
        <p className="text-sm text-emerald-300/90 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          {notice}
        </p>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900/50 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-medium text-slate-300">Synced templates</h3>
          <span className="text-xs text-slate-500">{templates.length} total</span>
        </div>
        <div className="p-4 space-y-2 max-h-[70vh] overflow-y-auto">
          {loading ? (
            <p className="text-sm text-slate-400">Loading templates…</p>
          ) : templates.length === 0 ? (
            <p className="text-sm text-slate-500 rounded-lg border border-dashed border-slate-700 p-4">
              No templates synced yet. Create marketing/utility templates in Meta Business
              Manager, then click <strong className="text-slate-300">Sync from Meta</strong>.
            </p>
          ) : (
            templates.map((template) => (
              <div
                key={template.id}
                className="rounded-lg border border-slate-800 bg-slate-950 p-3 flex items-start justify-between gap-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-medium text-slate-100">{template.name}</p>
                    <StatusBadge status={template.status} />
                    {template.category && (
                      <span className="px-2 py-0.5 rounded text-xs border border-slate-700 bg-slate-800 text-slate-400">
                        {template.category}
                      </span>
                    )}
                    <span className="text-xs text-slate-500">{template.language}</span>
                  </div>
                  {template.body_text && (
                    <p className="text-xs text-slate-500 mt-1.5 whitespace-pre-wrap line-clamp-3">
                      {template.body_text}
                    </p>
                  )}
                  {template.variable_count > 0 && (
                    <p className="text-xs text-slate-600 mt-1">
                      {template.variable_count} variable{template.variable_count === 1 ? "" : "s"}
                    </p>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
