import { useCallback, useEffect, useState } from "react";
import {
  client,
  type ClientHistoryFeedResponse,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { ColumnVisibilityMenu } from "../components/ColumnVisibilityMenu";
import { Pagination } from "../components/Pagination";
import { sourceLabelForHistory } from "../components/ClientHistoryPanel";
import {
  useColumnVisibility,
  type ColumnDef,
} from "../hooks/useColumnVisibility";

interface ClientHistoryPageProps {
  onError: (message: string) => void;
  onOpenClient?: (buyerId: number) => void;
  initialBuyerId?: number | null;
}

const PAGE_SIZE = 30;

const CLIENT_HISTORY_COLUMNS: ColumnDef[] = [
  { id: "when", label: "Date & time" },
  { id: "client", label: "Client", locked: true },
  { id: "source", label: "Source" },
  { id: "added_by", label: "Added by" },
  { id: "remark", label: "Remark" },
];

function formatWhen(iso: string | null | undefined) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function ClientHistoryPage({
  onError,
  onOpenClient,
  initialBuyerId = null,
}: ClientHistoryPageProps) {
  const { user } = useAuth();
  const columnsUi = useColumnVisibility(
    "client_history",
    CLIENT_HISTORY_COLUMNS,
    user?.id,
  );
  const [data, setData] = useState<ClientHistoryFeedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [buyerFilter, setBuyerFilter] = useState<number | null>(initialBuyerId);
  const [searchDraft, setSearchDraft] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await client.listClientHistory({
        page,
        page_size: PAGE_SIZE,
        search: search || undefined,
        buyer_id: buyerFilter ?? undefined,
      });
      setData(result);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load client history");
    } finally {
      setLoading(false);
    }
  }, [buyerFilter, onError, page, search]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setBuyerFilter(initialBuyerId ?? null);
    setPage(1);
  }, [initialBuyerId]);

  function applySearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchDraft.trim());
    setPage(1);
  }

  return (
    <div className="space-y-5 w-full min-w-0">
      <div>
        <h1 className="text-xl font-semibold text-slate-100">Client history</h1>
        <p className="text-sm text-slate-400 mt-1">
          Full change log of client remarks — updates from the clients table, buyer profile, and
          post-call notes — with date, time, and who saved each version.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-end sm:justify-between">
        <form onSubmit={applySearch} className="flex w-full min-w-0 flex-1 gap-2 sm:max-w-xl">
          <input
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Search by company name…"
            className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="px-3 py-2 rounded-lg bg-slate-800 border border-slate-700 text-sm hover:bg-slate-700"
          >
            Search
          </button>
        </form>
        <div className="flex flex-wrap items-center gap-3">
          {buyerFilter != null ? (
            <button
              type="button"
              onClick={() => {
                setBuyerFilter(null);
                setPage(1);
              }}
              className="text-sm text-slate-400 hover:text-slate-200"
            >
              Clear client filter
            </button>
          ) : null}
          <ColumnVisibilityMenu
            columns={columnsUi.columns}
            isVisible={columnsUi.isVisible}
            toggle={columnsUi.toggle}
            showAll={columnsUi.showAll}
            resetDefaults={columnsUi.resetDefaults}
            hiddenCount={columnsUi.hiddenCount}
          />
        </div>
      </div>

      <div className="rounded-xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          {columnsUi.css ? <style>{columnsUi.css}</style> : null}
          <table className="min-w-full text-sm">
            <thead className="bg-slate-900/80 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th data-col="when" className="px-4 py-3 min-w-[160px]">Date & time</th>
                <th data-col="client" className="px-4 py-3 min-w-[180px]">Client</th>
                <th data-col="source" className="px-4 py-3 min-w-[120px]">Source</th>
                <th data-col="added_by" className="px-4 py-3 min-w-[100px]">Added by</th>
                <th data-col="remark" className="px-4 py-3 min-w-[280px]">Remark</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {loading && !data ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    Loading client history…
                  </td>
                </tr>
              ) : null}
              {!loading && (data?.rows.length ?? 0) === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No remarks in history yet. Edits in the clients table and saved call remarks appear
                    here automatically.
                  </td>
                </tr>
              ) : null}
              {(data?.rows || []).map((row) => (
                <tr key={row.id} className="hover:bg-slate-900/40 align-top">
                  <td data-col="when" className="px-4 py-3 text-slate-400 whitespace-nowrap">
                    {formatWhen(row.at)}
                  </td>
                  <td data-col="client" className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => {
                        if (onOpenClient) {
                          onOpenClient(row.buyer_id);
                          return;
                        }
                        setBuyerFilter(row.buyer_id);
                        setPage(1);
                      }}
                      className="text-left text-emerald-400 hover:text-emerald-300 font-medium"
                    >
                      {row.company_name}
                    </button>
                    {row.country ? (
                      <p className="text-xs text-slate-500 mt-0.5">{row.country}</p>
                    ) : null}
                  </td>
                  <td data-col="source" className="px-4 py-3">
                    <span className="inline-flex rounded-full border border-slate-700 px-2 py-0.5 text-[11px] uppercase tracking-wide text-slate-400">
                      {sourceLabelForHistory(row.source)}
                    </span>
                  </td>
                  <td data-col="added_by" className="px-4 py-3 text-slate-400">{row.by || "—"}</td>
                  <td data-col="remark" className="px-4 py-3 text-slate-200 whitespace-pre-wrap break-words min-w-[280px]">
                    {row.text}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {data && data.total_pages > 1 ? (
        <Pagination
          page={data.page}
          totalPages={data.total_pages}
          totalItems={data.total}
          pageSize={data.page_size}
          onPageChange={setPage}
        />
      ) : null}
    </div>
  );
}
