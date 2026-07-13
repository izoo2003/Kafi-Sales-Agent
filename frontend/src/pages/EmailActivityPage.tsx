import { useCallback, useEffect, useState } from "react";
import {
  client,
  type EmailActivityCatalogItem,
  type EmailActivityEvent,
} from "../api/client";
import { Pagination } from "../components/Pagination";

interface EmailActivityPageProps {
  onError: (message: string) => void;
  onUnreadChange?: (count: number) => void;
}

const PAGE_SIZE = 30;
const POLL_MS = 12_000;

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

export function EmailActivityPage({ onError, onUnreadChange }: EmailActivityPageProps) {
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<EmailActivityEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<EmailActivityCatalogItem[]>([]);
  const [showCatalog, setShowCatalog] = useState(false);
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

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    client.listEmailActivityCatalog().then(setCatalog).catch(() => setCatalog([]));
  }, []);

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
            onClick={() => setShowCatalog((v) => !v)}
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
            onClick={() => void refresh()}
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
            Opens, clicks, bounces, and delivery confirmations appear when the mail provider
            reports them. SMTP send success/failure and bulk batch results are logged immediately.
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
