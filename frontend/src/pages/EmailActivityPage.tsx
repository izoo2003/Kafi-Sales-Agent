import { useCallback, useEffect, useState } from "react";
import {
  client,
  type EmailActivityCatalogItem,
  type EmailActivityEvent,
  type EmailActivityInsights,
  type EmailActivityModeStats,
} from "../api/client";
import { Pagination } from "../components/Pagination";

interface EmailActivityPageProps {
  onError: (message: string) => void;
  onUnreadChange?: (count: number) => void;
}

const PAGE_SIZE = 30;
const POLL_MS = 12_000;

type InsightsPeriod = 7 | 30 | 90 | null;

function severityClasses(severity: string) {
  switch (severity) {
    case "success":
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-200";
    case "error":
      return "border-red-500/30 bg-red-500/10 text-red-200";
    case "warning":
      return "border-amber-500/30 bg-amber-500/10 text-amber-100";
    default:
      return "border-slate-700 bg-slate-900 text-slate-200";
  }
}

function formatWhen(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function StatTile({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "neutral" | "good" | "bad" | "accent";
}) {
  const toneClass =
    tone === "good"
      ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
      : tone === "bad"
        ? "border-red-500/25 bg-red-500/10 text-red-100"
        : tone === "accent"
          ? "border-sky-500/25 bg-sky-500/10 text-sky-100"
          : "border-slate-700/80 bg-slate-950/60 text-slate-100";
  return (
    <div className={`rounded-xl border px-3.5 py-3 ${toneClass}`}>
      <p className="text-[11px] uppercase tracking-[0.12em] opacity-70">{label}</p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint ? <p className="mt-1 text-xs opacity-65">{hint}</p> : null}
    </div>
  );
}

function ModeBlock({
  title,
  subtitle,
  stats,
  showBatches,
}: {
  title: string;
  subtitle: string;
  stats: EmailActivityModeStats;
  showBatches?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
      <div className="mb-3">
        <h4 className="text-sm font-medium text-slate-100">{title}</h4>
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {showBatches ? (
          <StatTile
            label="Batches"
            value={stats.batches ?? 0}
            hint={`${stats.batches_partial ?? 0} partial · ${stats.batches_failed ?? 0} failed`}
            tone="accent"
          />
        ) : null}
        <StatTile label="Sent" value={stats.sent} hint={`${stats.success_rate_pct}% success`} tone="good" />
        <StatTile label="Failed" value={stats.failed} tone="bad" />
        <StatTile
          label="Opened"
          value={stats.opened}
          hint={`${stats.open_rate_pct}% of sent`}
          tone="accent"
        />
        <StatTile label="Not opened" value={stats.not_opened} />
        <StatTile label="Attempted" value={stats.attempted} />
      </div>
    </div>
  );
}

export function EmailActivityPage({ onError, onUnreadChange }: EmailActivityPageProps) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<EmailActivityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<EmailActivityCatalogItem[]>([]);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const [insightsPeriod, setInsightsPeriod] = useState<InsightsPeriod>(30);
  const [insights, setInsights] = useState<EmailActivityInsights | null>(null);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [unreadOnly, setUnreadOnly] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await client.listEmailActivity({
        page,
        page_size: PAGE_SIZE,
        unread_only: unreadOnly,
      });
      setRows(result.rows);
      setTotal(result.total);
      setTotalPages(result.total_pages);
      setUnreadCount(result.unread_count);
      onUnreadChange?.(result.unread_count);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load email activity");
    } finally {
      setLoading(false);
    }
  }, [onError, onUnreadChange, page, unreadOnly]);

  const refreshInsights = useCallback(async () => {
    setInsightsLoading(true);
    try {
      const result = await client.getEmailActivityInsights(insightsPeriod);
      setInsights(result);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load email insights");
    } finally {
      setInsightsLoading(false);
    }
  }, [insightsPeriod, onError]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    client.listEmailActivityCatalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);

  useEffect(() => {
    if (!showInsights) return;
    void refreshInsights();
  }, [showInsights, refreshInsights]);

  async function markAllRead() {
    try {
      await client.markEmailActivityRead({ mark_all: true });
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to mark notifications read");
    }
  }

  async function markOneRead(eventId: number) {
    try {
      await client.markEmailActivityRead({ event_ids: [eventId] });
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to mark notification read");
    }
  }

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-slate-100">Email Activity</h2>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Live notifications for outbound email — sent, failed, bulk batches, mailbox issues,
            skips, and engagement events when available.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setShowInsights((v) => !v);
              if (!showInsights) setShowCatalog(false);
            }}
            className={`px-3 py-1.5 rounded-lg text-sm border ${
              showInsights
                ? "bg-sky-600 border-sky-500 text-white"
                : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
            }`}
          >
            {showInsights ? "Hide insights" : "Insights"}
          </button>
          <button
            type="button"
            onClick={() => setUnreadOnly((v) => !v)}
            className={`px-3 py-1.5 rounded-lg text-sm border ${
              unreadOnly
                ? "bg-emerald-600 border-emerald-500 text-white"
                : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
            }`}
          >
            {unreadOnly ? "Showing unread" : "Show unread only"}
          </button>
          <button
            type="button"
            onClick={() => {
              setShowCatalog((v) => !v);
              if (!showCatalog) setShowInsights(false);
            }}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-300"
          >
            {showCatalog ? "Hide event types" : "All event types"}
          </button>
          <button
            type="button"
            onClick={() => void markAllRead()}
            disabled={unreadCount === 0}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm text-slate-300 disabled:opacity-40"
          >
            Mark all read
          </button>
          <button
            type="button"
            onClick={() => {
              void refresh();
              if (showInsights) void refreshInsights();
            }}
            className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-slate-300">
          {total} event{total === 1 ? "" : "s"}
        </span>
        <span className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-200">
          {unreadCount} unread
        </span>
      </div>

      {showInsights && (
        <div className="rounded-2xl border border-slate-800 bg-gradient-to-b from-slate-900 to-slate-950 p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-slate-100">Email insights</h3>
              <p className="text-xs text-slate-500 mt-1 max-w-xl">
                Sent vs failed, opened vs not opened, split by individual and bulk outreach.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(
                [
                  [7, "7d"],
                  [30, "30d"],
                  [90, "90d"],
                  [null, "All"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setInsightsPeriod(value)}
                  className={`px-2.5 py-1 rounded-md text-xs border ${
                    insightsPeriod === value
                      ? "bg-sky-600 border-sky-500 text-white"
                      : "bg-slate-900 border-slate-700 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {insightsLoading && !insights ? (
            <p className="text-sm text-slate-400">Loading insights…</p>
          ) : insights ? (
            <>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
                <StatTile label="Total sent" value={insights.totals.sent} tone="good" />
                <StatTile label="Total failed" value={insights.totals.failed} tone="bad" />
                <StatTile
                  label="Opened"
                  value={insights.totals.opened}
                  hint={`${insights.totals.open_rate_pct}% open rate`}
                  tone="accent"
                />
                <StatTile label="Not opened" value={insights.totals.not_opened} />
                <StatTile
                  label="Success rate"
                  value={`${insights.totals.success_rate_pct}%`}
                  hint={`${insights.totals.attempted} attempted`}
                />
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
                <ModeBlock
                  title="Individual emails"
                  subtitle="One-off sends to a single lead"
                  stats={insights.individual}
                />
                <ModeBlock
                  title="Bulk emails"
                  subtitle="Multi-recipient campaigns from Leads"
                  stats={insights.bulk}
                  showBatches
                />
              </div>

              {!insights.tracking_enabled ? (
                <p className="text-xs text-amber-200/80 border border-amber-500/20 bg-amber-500/10 rounded-lg px-3 py-2">
                  Open tracking needs a public API URL (`PUBLIC_API_BASE_URL`). Opens will stay at
                  0 until emails are sent with that configured on the live backend.
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  Opens are counted when recipients load the tracking pixel (HTML clients). Some
                  clients block images, so open rate is a lower bound.
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-slate-400">No insight data yet.</p>
          )}
        </div>
      )}

      {showCatalog && (
        <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h3 className="text-sm font-medium text-slate-300 mb-3">
            Notification types this feed can show
          </h3>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {catalog.map((item) => (
              <div
                key={item.event_type}
                className={`rounded-lg border px-3 py-2 ${severityClasses(item.severity)}`}
              >
                <p className="text-sm font-medium">{item.label}</p>
                <p className="text-xs opacity-80 mt-1">{item.description}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Opens are recorded via a tracking pixel on outbound HTML emails. SMTP send
            success/failure and bulk batch results are logged immediately.
          </p>
        </div>
      )}

      {loading && rows.length === 0 ? (
        <p className="text-slate-400">Loading email activity…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 p-8 text-center">
          <p className="text-slate-300 font-medium">No email activity yet</p>
          <p className="text-sm text-slate-500 mt-2">
            Send a manual or template email from the Leads table — results show up here in real time.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((event) => {
            const unread = !event.read_at;
            return (
              <li
                key={event.id}
                className={`rounded-xl border p-4 ${severityClasses(event.severity)} ${
                  unread ? "ring-1 ring-emerald-500/20" : "opacity-90"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] uppercase tracking-wide opacity-70">
                        {event.event_label}
                      </span>
                      {unread && (
                        <span className="text-[10px] uppercase tracking-wide rounded bg-emerald-500/20 px-1.5 py-0.5 text-emerald-200">
                          New
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium mt-1">{event.title}</p>
                    <p className="text-sm opacity-90 mt-1 whitespace-pre-wrap">{event.message}</p>
                    <p className="text-xs opacity-60 mt-2">{formatWhen(event.created_at)}</p>
                  </div>
                  {unread && (
                    <button
                      type="button"
                      onClick={() => void markOneRead(event.id)}
                      className="shrink-0 px-2 py-1 rounded bg-black/20 hover:bg-black/30 text-xs"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          totalItems={total}
          pageSize={PAGE_SIZE}
          onPageChange={setPage}
          disabled={loading}
        />
      )}
    </section>
  );
}
