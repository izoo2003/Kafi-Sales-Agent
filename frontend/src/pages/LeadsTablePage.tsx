import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CountrySelect } from "../components/CountrySelect";
import {
  client,
  type LeadTableFilters,
  type LeadTableRow,
  type LeadTableRowUpdate,
} from "../api/client";
import { formatCountryLabel } from "../data/countries";
import { ScoreBadge } from "../components/ScoreBadge";
import { MarketRoleBadge } from "../components/MarketRoleBadge";
import { ProducerTierBadge } from "../components/ProducerTierBadge";
import { BulkEmailModal } from "../components/BulkEmailModal";
import { LeadsTableCsvImport } from "../components/LeadsTableCsvImport";
import { SocialLinksCell } from "../components/SocialLinksCell";
import { exportLeadsTableCsv } from "../utils/exportCsv";

interface LeadsTablePageProps {
  onError: (message: string) => void;
  onSelectLead: (leadId: number) => void;
}

type SortField =
  | "company_name"
  | "country"
  | "latest_score"
  | "market_role";

const EDIT_INPUT =
  "w-full min-w-[120px] rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-sm text-slate-200";

const MAX_BULK_ONBOARD = 25;
const BULK_ONBOARD_DELAY_MS = 1000;

interface BulkOnboardRowResult {
  id: number;
  company_name: string;
  status: "success" | "failed";
  score?: string;
  reasoning?: string;
  error?: string;
}

function scoreLabel(score: string | null): string {
  return score ?? "Unscored";
}

function rowDraftKey(row: LeadTableRow): string {
  return JSON.stringify({
    company_name: row.company_name,
    country: row.country,
    industry: row.industry,
    website_url: row.website_url,
    contact_name: row.contact_name,
    contact_email: row.contact_email,
    contact_phone: row.contact_phone,
    linkedin_company_url: row.linkedin_company_url,
    facebook_company_url: row.facebook_company_url,
    instagram_company_url: row.instagram_company_url,
  });
}

function normalizeSocialUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function buildUpdatePayload(draft: LeadTableRow): LeadTableRowUpdate {
  return {
    company_name: draft.company_name,
    country: draft.country ?? undefined,
    industry: draft.industry ?? undefined,
    website_url: draft.website_url ?? undefined,
    linkedin_company_url: normalizeSocialUrl(draft.linkedin_company_url),
    facebook_company_url: normalizeSocialUrl(draft.facebook_company_url),
    instagram_company_url: normalizeSocialUrl(draft.instagram_company_url),
    contact_id: draft.contact_id ?? undefined,
    contact_name: draft.contact_name ?? undefined,
    contact_email: draft.contact_email ?? undefined,
    contact_phone: draft.contact_phone ?? undefined,
  };
}

export function LeadsTablePage({ onError, onSelectLead }: LeadsTablePageProps) {
  const [filters, setFilters] = useState<LeadTableFilters | null>(null);
  const [rows, setRows] = useState<LeadTableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, LeadTableRow>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [originalKeys, setOriginalKeys] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [savingAll, setSavingAll] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [bulkOnboarding, setBulkOnboarding] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{
    current: number;
    total: number;
    name: string;
  } | null>(null);
  const [bulkResults, setBulkResults] = useState<BulkOnboardRowResult[] | null>(null);
  const [showBulkEmail, setShowBulkEmail] = useState(false);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [bulkEmailNotice, setBulkEmailNotice] = useState<string | null>(null);
  const [deduping, setDeduping] = useState(false);

  const [score, setScore] = useState("");
  const [marketRole, setMarketRole] = useState("");
  const [country, setCountry] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("company_name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const loadTable = useCallback(async () => {
    setLoading(true);
    try {
      const result = await client.listLeadsTable({
        score: score || undefined,
        market_role: marketRole || undefined,
        country: country || undefined,
        q: search.trim() || undefined,
        sort_by: sortBy,
        sort_dir: sortDir,
      });
      setRows(result.rows);
      setTotal(result.total);
      setFilteredCount(result.filtered_count);
      setSelected(new Set());
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load leads table");
    } finally {
      setLoading(false);
    }
  }, [country, marketRole, onError, score, search, sortBy, sortDir]);

  useEffect(() => {
    client
      .listLeadTableFilters()
      .then(setFilters)
      .catch(() => onError("Failed to load lead filters"));
  }, [onError]);

  useEffect(() => {
    void loadTable();
  }, [loadTable]);

  function enterEditMode() {
    setDrafts(Object.fromEntries(rows.map((row) => [row.id, { ...row }])));
    setOriginalKeys(Object.fromEntries(rows.map((row) => [row.id, rowDraftKey(row)])));
    setEditMode(true);
    setSaveNotice(null);
  }

  function updateDraft(rowId: number, field: keyof LeadTableRow, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [rowId]: {
        ...prev[rowId],
        [field]: value || null,
      },
    }));
  }

  function isRowDirty(rowId: number): boolean {
    const draft = drafts[rowId];
    if (!draft) return false;
    return rowDraftKey(draft) !== originalKeys[rowId];
  }

  const dirtyCount = useMemo(
    () => Object.keys(drafts).filter((id) => isRowDirty(Number(id))).length,
    [drafts, originalKeys],
  );

  async function saveRow(rowId: number) {
    const draft = draftsRef.current[rowId];
    if (!draft) return;

    setSavingId(rowId);
    setSaveNotice(null);
    try {
      const updated = await client.updateLeadTableRow(rowId, buildUpdatePayload(draft));
      setRows((prev) => prev.map((row) => (row.id === rowId ? updated : row)));
      setDrafts((prev) => ({ ...prev, [rowId]: updated }));
      setOriginalKeys((prev) => ({ ...prev, [rowId]: rowDraftKey(updated) }));
      setSaveNotice(`Saved ${updated.company_name}`);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save lead");
    } finally {
      setSavingId(null);
    }
  }

  function toggleSelected(rowId: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    if (selected.size === rows.length) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(rows.map((row) => row.id)));
  }

  async function bulkResearchAndScore() {
    const ids = [...selected];
    if (ids.length === 0) return;

    if (ids.length > MAX_BULK_ONBOARD) {
      onError(`Select at most ${MAX_BULK_ONBOARD} leads per batch`);
      return;
    }

    const withoutWebsite = rows.filter((row) => ids.includes(row.id) && !row.website_url?.trim());
    const estimateSec = ids.length * 6;
    const confirmed = window.confirm(
      `Research & score ${ids.length} lead${ids.length === 1 ? "" : "s"}?\n\n` +
        `• Same pipeline as single-lead research — quality does not drop.\n` +
        `• Runs one at a time (~${estimateSec}s estimated).\n` +
        (withoutWebsite.length > 0
          ? `• ${withoutWebsite.length} selected lead${withoutWebsite.length === 1 ? " has" : "s have"} no website — fit signals will be weaker.\n`
          : "") +
        `\nContinue?`,
    );
    if (!confirmed) return;

    setBulkOnboarding(true);
    setBulkResults(null);
    setSaveNotice(null);

    const results: BulkOnboardRowResult[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const row = rows.find((r) => r.id === id);
      const companyName = row?.company_name ?? `Lead #${id}`;
      setBulkProgress({ current: i + 1, total: ids.length, name: companyName });

      try {
        const result = await client.onboardLead(id);
        results.push({
          id,
          company_name: companyName,
          status: "success",
          score: result.score,
          reasoning: result.reasoning,
        });
      } catch (e) {
        results.push({
          id,
          company_name: companyName,
          status: "failed",
          error: e instanceof Error ? e.message : "Research & score failed",
        });
      }

      if (i < ids.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, BULK_ONBOARD_DELAY_MS));
      }
    }

    setBulkProgress(null);
    setBulkOnboarding(false);
    setBulkResults(results);
    setSelected(new Set());
    await loadTable();
  }

  async function removeEmptyImports() {
    const confirmed = window.confirm(
      "Remove empty CSV imports?\n\n" +
        "• Deletes CSV leads with no website, email, or score (failed scrapes).\n" +
        "• Use this before re-importing the same file with fresh scraped data.\n\n" +
        "Continue?",
    );
    if (!confirmed) return;

    setDeduping(true);
    setSaveNotice(null);
    try {
      const result = await client.cleanupSparseCsvLeads();
      await loadTable();
      setSaveNotice(
        result.removed_count > 0
          ? `Removed ${result.removed_count} empty CSV import${result.removed_count === 1 ? "" : "s"}`
          : "No empty CSV imports found",
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to remove empty imports");
    } finally {
      setDeduping(false);
    }
  }

  async function removeDuplicates() {
    const confirmed = window.confirm(
      "Remove duplicate leads from the table?\n\n" +
        "• Duplicates are matched by company name or website domain.\n" +
        "• The record with the most details (website, email, score) is kept.\n" +
        "• Empty/sparse duplicates from failed imports are removed first.\n\n" +
        "Continue?",
    );
    if (!confirmed) return;

    setDeduping(true);
    setSaveNotice(null);
    try {
      const result = await client.dedupeLeadsTable();
      await loadTable();
      setSaveNotice(
        result.removed_count > 0
          ? `Removed ${result.removed_count} duplicate lead${result.removed_count === 1 ? "" : "s"} (${result.groups.length} group${result.groups.length === 1 ? "" : "s"})`
          : "No duplicate leads found",
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to remove duplicates");
    } finally {
      setDeduping(false);
    }
  }

  async function deleteRows(rowIds: number[]) {
    if (rowIds.length === 0) return;

    const names = rows
      .filter((row) => rowIds.includes(row.id))
      .map((row) => row.company_name);
    const preview =
      names.length === 1
        ? names[0]
        : `${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`;
    const confirmed = window.confirm(
      rowIds.length === 1
        ? `Delete "${preview}"? This cannot be undone.`
        : `Delete ${rowIds.length} leads (${preview})? This cannot be undone.`,
    );
    if (!confirmed) return;

    if (rowIds.length === 1) {
      setDeletingId(rowIds[0]);
    } else {
      setDeletingSelected(true);
    }
    setSaveNotice(null);

    try {
      for (const rowId of rowIds) {
        await client.deleteLeadTableRow(rowId);
      }
      setRows((prev) => prev.filter((row) => !rowIds.includes(row.id)));
      setTotal((prev) => Math.max(0, prev - rowIds.length));
      setFilteredCount((prev) => Math.max(0, prev - rowIds.length));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const rowId of rowIds) next.delete(rowId);
        return next;
      });
      setDrafts((prev) => {
        const next = { ...prev };
        for (const rowId of rowIds) delete next[rowId];
        return next;
      });
      setOriginalKeys((prev) => {
        const next = { ...prev };
        for (const rowId of rowIds) delete next[rowId];
        return next;
      });
      setSaveNotice(
        `Deleted ${rowIds.length} lead${rowIds.length === 1 ? "" : "s"}`,
      );
      const updatedFilters = await client.listLeadTableFilters();
      setFilters(updatedFilters);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to delete lead(s)");
    } finally {
      setDeletingId(null);
      setDeletingSelected(false);
    }
  }

  async function finishEditing() {
    const dirtyIds = Object.keys(draftsRef.current)
      .map(Number)
      .filter((id) => {
        const draft = draftsRef.current[id];
        if (!draft) return false;
        return rowDraftKey(draft) !== originalKeys[id];
      });

    if (dirtyIds.length === 0) {
      setEditMode(false);
      setDrafts({});
      setOriginalKeys({});
      setSaveNotice(null);
      return;
    }

    setSavingAll(true);
    setSaveNotice(null);
    try {
      const updatedById = new Map<number, LeadTableRow>();
      for (const rowId of dirtyIds) {
        const draft = draftsRef.current[rowId];
        if (!draft) continue;
        const updated = await client.updateLeadTableRow(rowId, buildUpdatePayload(draft));
        updatedById.set(rowId, updated);
      }
      setRows((prev) => prev.map((row) => updatedById.get(row.id) ?? row));
      setEditMode(false);
      setDrafts({});
      setOriginalKeys({});
      setSaveNotice(
        `Saved ${updatedById.size} row${updatedById.size === 1 ? "" : "s"}`,
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save changes");
    } finally {
      setSavingAll(false);
    }
  }

  function toggleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortBy(field);
    setSortDir(field === "company_name" || field === "country" ? "asc" : "desc");
  }

  function clearFilters() {
    setScore("");
    setMarketRole("");
    setCountry("");
    setSearch("");
    setSortBy("company_name");
    setSortDir("desc");
  }

  function sortIndicator(field: SortField): string {
    if (sortBy !== field) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  const hasActiveFilters = Boolean(score || marketRole || country || search.trim());
  const allOnPageSelected = rows.length > 0 && selected.size === rows.length;

  return (
    <section className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-medium text-slate-100">Leads table</h2>
          <p className="text-sm text-slate-500 mt-1">
            Browse, filter, edit, delete, and export leads. Social icons link to Facebook, Instagram,
            and LinkedIn — filled automatically when you research a lead (scraped from their website).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm text-slate-400 mr-2">
            Showing {filteredCount} of {total}
          </p>
          <button
            type="button"
            onClick={() => setShowCsvImport(true)}
            disabled={bulkOnboarding || deletingSelected || deletingId !== null || editMode}
            className="px-3 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 border border-violet-600/50 text-sm font-medium disabled:opacity-50"
          >
            Import CSV
          </button>
          <button
            type="button"
            onClick={() => setShowBulkEmail(true)}
            disabled={
              selected.size === 0 ||
              bulkOnboarding ||
              deletingSelected ||
              deletingId !== null ||
              editMode
            }
            className="px-3 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 border border-sky-600/50 text-sm font-medium disabled:opacity-50"
          >
            Create email drafts ({selected.size})
          </button>
          <button
            type="button"
            onClick={() => void bulkResearchAndScore()}
            disabled={
              selected.size === 0 ||
              bulkOnboarding ||
              deletingSelected ||
              deletingId !== null ||
              editMode
            }
            className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 border border-emerald-600/50 text-sm font-medium disabled:opacity-50"
          >
            {bulkOnboarding
              ? bulkProgress
                ? `Researching ${bulkProgress.current}/${bulkProgress.total}…`
                : "Starting…"
              : `Research & score (${selected.size})`}
          </button>
          <button
            type="button"
            onClick={() => void deleteRows([...selected])}
            disabled={selected.size === 0 || deletingSelected || deletingId !== null}
            className="px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-800 border border-red-800/60 text-sm text-red-200 disabled:opacity-50"
          >
            {deletingSelected ? "Deleting…" : `Delete selected (${selected.size})`}
          </button>
          <button
            type="button"
            onClick={() => void removeEmptyImports()}
            disabled={deduping || rows.length === 0 || loading}
            className="px-3 py-1.5 rounded-lg bg-amber-900/60 hover:bg-amber-800 border border-amber-800/60 text-sm text-amber-100 disabled:opacity-50"
          >
            {deduping ? "Cleaning…" : "Remove empty imports"}
          </button>
          <button
            type="button"
            onClick={() => void removeDuplicates()}
            disabled={deduping || rows.length === 0 || loading}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm disabled:opacity-50"
          >
            Remove duplicates
          </button>
          <button
            type="button"
            onClick={() => exportLeadsTableCsv(rows)}
            disabled={rows.length === 0}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm disabled:opacity-50"
          >
            Export Excel
          </button>
          <button
            type="button"
            onClick={() => {
              if (editMode) {
                void finishEditing();
              } else {
                enterEditMode();
              }
            }}
            disabled={savingAll}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-50 ${
              editMode
                ? "bg-amber-600 hover:bg-amber-500"
                : "bg-emerald-600 hover:bg-emerald-500"
            }`}
          >
            {savingAll ? "Saving…" : editMode ? "Done editing" : "Edit table"}
          </button>
        </div>
      </div>

      {editMode && (
        <p className="text-xs text-amber-300/90 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2">
          Edit mode is on. Update fields after visiting a company website, then click Done editing to save all changes (or Save on a single row).
          Social URLs can be edited in the Socials column.
          {dirtyCount > 0 ? ` ${dirtyCount} unsaved row${dirtyCount === 1 ? "" : "s"}.` : ""}
        </p>
      )}

      {saveNotice && (
        <p className="text-xs text-emerald-300 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
          {saveNotice}
        </p>
      )}

      {bulkEmailNotice && (
        <p className="text-xs text-emerald-300 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2">
          {bulkEmailNotice}
        </p>
      )}

      {bulkProgress && (
        <p className="text-xs text-slate-300 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">
          Researching &amp; scoring {bulkProgress.current} of {bulkProgress.total}:{" "}
          <strong className="text-slate-200">{bulkProgress.name}</strong>
          <span className="text-slate-500 ml-2">(one lead at a time — same quality as manual)</span>
        </p>
      )}

      {bulkResults && bulkResults.length > 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-slate-200">
              Bulk research complete —{" "}
              {bulkResults.filter((r) => r.status === "success").length} succeeded,{" "}
              {bulkResults.filter((r) => r.status === "failed").length} failed
              {(() => {
                const hot = bulkResults.filter((r) => r.score === "HOT").length;
                const warm = bulkResults.filter((r) => r.score === "WARM").length;
                const cold = bulkResults.filter((r) => r.score === "COLD").length;
                if (hot + warm + cold === 0) return null;
                return (
                  <span className="text-slate-400">
                    {" "}
                    · {hot} HOT, {warm} WARM, {cold} COLD
                  </span>
                );
              })()}
            </p>
            <button
              type="button"
              onClick={() => setBulkResults(null)}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              Dismiss
            </button>
          </div>
          <ul className="max-h-40 overflow-y-auto space-y-1 text-xs">
            {bulkResults.map((result) => (
              <li key={result.id} className="flex items-center gap-2 text-slate-400">
                {result.status === "success" && result.score ? (
                  <ScoreBadge score={result.score} />
                ) : (
                  <span className="px-2 py-0.5 rounded text-xs border border-red-500/30 text-red-300">
                    Failed
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => onSelectLead(result.id)}
                  className="text-slate-300 hover:text-emerald-300 truncate text-left"
                >
                  {result.company_name}
                </button>
                {result.error && <span className="text-red-400 truncate">{result.error}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-xs text-slate-400">
            Score
            <select
              value={score}
              onChange={(e) => setScore(e.target.value)}
              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
            >
              <option value="">All scores</option>
              {(filters?.scores ?? ["HOT", "WARM", "COLD", "Unscored"]).map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>

          <label className="block text-xs text-slate-400">
            Market role
            <select
              value={marketRole}
              onChange={(e) => setMarketRole(e.target.value)}
              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
            >
              <option value="">All roles</option>
              {(filters?.market_roles ?? ["consumer", "producer", "hybrid", "unknown"]).map((option) => (
                <option key={option} value={option}>
                  {option === "unknown" ? "Unclassified" : option.charAt(0).toUpperCase() + option.slice(1)}
                </option>
              ))}
            </select>
          </label>

          <CountrySelect
            label="Country"
            value={country}
            onChange={setCountry}
            allowEmpty
            emptyLabel="All countries"
          />

          <label className="block text-xs text-slate-400">
            Search
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Company, email, contact…"
              className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
            />
          </label>
        </div>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="text-xs text-slate-400 hover:text-slate-200"
          >
            Clear filters
          </button>
        )}
      </div>

      {loading ? (
        <p className="text-slate-400 text-sm">Loading leads table…</p>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-8 text-center">
          <p className="text-slate-400 text-sm">No leads match these filters.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-slate-800 overflow-hidden">
          <table className="w-full table-fixed text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-800 bg-slate-950">
                <th className="py-3 pl-3 pr-2 w-[3%]">
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={toggleSelectAllOnPage}
                    aria-label="Select all leads on this page"
                    className="rounded border-slate-600 bg-slate-950"
                  />
                </th>
                <th className="py-3 px-3 w-[20%]">
                  <button type="button" onClick={() => toggleSort("company_name")} className="hover:text-slate-300">
                    Company{sortIndicator("company_name")}
                  </button>
                </th>
                <th className="py-3 pr-3 w-[7%]">
                  <button type="button" onClick={() => toggleSort("latest_score")} className="hover:text-slate-300">
                    Score{sortIndicator("latest_score")}
                  </button>
                </th>
                <th className="py-3 pr-3 w-[16%]">
                  <button type="button" onClick={() => toggleSort("market_role")} className="hover:text-slate-300">
                    Role{sortIndicator("market_role")}
                  </button>
                </th>
                <th className="py-3 pr-3 w-[10%]">
                  <button type="button" onClick={() => toggleSort("country")} className="hover:text-slate-300">
                    Country{sortIndicator("country")}
                  </button>
                </th>
                <th className="py-3 pr-3 w-[11%]">Contact</th>
                <th className="py-3 pr-3 w-[15%]">Email</th>
                <th className="py-3 pr-3 w-[9%]">Phone</th>
                <th className="py-3 pr-3 w-[11%]">Website</th>
                <th className="py-3 pr-3 w-[10%]">Socials</th>
                {editMode && <th className="py-3 pr-3 w-[8%]">Edit</th>}
                <th className="py-3 pr-3 w-[7%]">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const draft = drafts[row.id] ?? row;
                const dirty = editMode && isRowDirty(row.id);

                return (
                  <tr
                    key={row.id}
                    onClick={() => {
                      if (!editMode) onSelectLead(row.id);
                    }}
                    className={`border-b border-slate-800/60 ${
                      editMode ? "" : "cursor-pointer hover:bg-slate-900/80"
                    } ${dirty ? "bg-amber-500/5" : ""} ${selected.has(row.id) ? "bg-slate-900/40" : ""}`}
                  >
                    <td className="py-3 pl-3 pr-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleSelected(row.id)}
                        aria-label={`Select ${row.company_name}`}
                        className="rounded border-slate-600 bg-slate-950"
                      />
                    </td>
                    <td className="py-3 px-3 text-slate-200 font-medium">
                      {editMode ? (
                        <input
                          value={draft.company_name}
                          onChange={(e) => updateDraft(row.id, "company_name", e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className={EDIT_INPUT}
                        />
                      ) : (
                        <>
                          <div className="truncate">{row.company_name}</div>
                          {row.score_reasoning && (
                            <p className="text-xs text-slate-500 mt-1 line-clamp-1">{row.score_reasoning}</p>
                          )}
                        </>
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <ScoreBadge score={scoreLabel(row.latest_score)} />
                    </td>
                    <td className="py-3 pr-3">
                      <div className="flex flex-col gap-1">
                        <MarketRoleBadge role={row.market_role ?? "unknown"} />
                        {(row.market_role === "producer" || row.market_role === "hybrid") && (
                          <ProducerTierBadge
                            tier={row.producer_tier}
                            conversionPct={row.producer_conversion_pct}
                            compact
                          />
                        )}
                      </div>
                      {(row.producer_tier_reasoning || row.market_role_reasoning) && !editMode && (
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                          {row.producer_tier_reasoning ?? row.market_role_reasoning}
                        </p>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-slate-400">
                      {editMode ? (
                        <div onClick={(e) => e.stopPropagation()}>
                          <CountrySelect
                            value={draft.country ?? ""}
                            onChange={(value) => updateDraft(row.id, "country", value)}
                          />
                        </div>
                      ) : (
                        <span className="truncate block">{formatCountryLabel(row.country)}</span>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-slate-400">
                      {editMode ? (
                        <input
                          value={draft.contact_name ?? ""}
                          onChange={(e) => updateDraft(row.id, "contact_name", e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className={EDIT_INPUT}
                        />
                      ) : (
                        <span className="truncate block">{row.contact_name || "—"}</span>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-slate-400">
                      {editMode ? (
                        <input
                          type="email"
                          value={draft.contact_email ?? ""}
                          onChange={(e) => updateDraft(row.id, "contact_email", e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className={EDIT_INPUT}
                        />
                      ) : row.contact_email ? (
                        <a
                          href={`mailto:${row.contact_email}`}
                          className="text-emerald-400 hover:text-emerald-300 truncate block"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.contact_email}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-3 text-slate-400">
                      {editMode ? (
                        <input
                          value={draft.contact_phone ?? ""}
                          onChange={(e) => updateDraft(row.id, "contact_phone", e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className={EDIT_INPUT}
                        />
                      ) : (
                        <span className="truncate block">{row.contact_phone || "—"}</span>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-slate-400">
                      {editMode ? (
                        <input
                          value={draft.website_url ?? ""}
                          onChange={(e) => updateDraft(row.id, "website_url", e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          placeholder="https://..."
                          className={EDIT_INPUT}
                        />
                      ) : row.website_url ? (
                        <a
                          href={row.website_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-400 hover:text-emerald-300 truncate block"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.website_url.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-3 pr-3">
                      <SocialLinksCell
                        companyName={draft.company_name}
                        facebookUrl={draft.facebook_company_url}
                        instagramUrl={draft.instagram_company_url}
                        linkedinUrl={draft.linkedin_company_url}
                        editMode={editMode}
                        onFieldChange={(field, value) => updateDraft(row.id, field, value)}
                      />
                    </td>
                    {editMode && (
                      <td className="py-3 pr-3 whitespace-nowrap">
                        <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            onClick={() => void saveRow(row.id)}
                            disabled={!dirty || savingId === row.id}
                            className="px-2 py-1 rounded bg-emerald-600 hover:bg-emerald-500 text-xs font-medium disabled:opacity-50"
                          >
                            {savingId === row.id ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => onSelectLead(row.id)}
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs"
                          >
                            Open
                          </button>
                        </div>
                      </td>
                    )}
                    <td className="py-3 pr-3 whitespace-nowrap">
                      <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          onClick={() => void deleteRows([row.id])}
                          disabled={deletingId === row.id || deletingSelected}
                          className="px-2 py-1 rounded bg-red-900/50 hover:bg-red-800 border border-red-800/50 text-xs text-red-200 disabled:opacity-50"
                        >
                          {deletingId === row.id ? "Deleting…" : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCsvImport && (
        <LeadsTableCsvImport
          onClose={() => setShowCsvImport(false)}
          onImported={() => void loadTable()}
          onError={onError}
        />
      )}

      {showBulkEmail && (
        <BulkEmailModal
          buyerIds={[...selected]}
          sampleBuyerId={[...selected][0] ?? null}
          onClose={() => setShowBulkEmail(false)}
          onError={onError}
          onCreated={(result) => {
            setBulkEmailNotice(
              `Created ${result.created_count} draft(s). ` +
                (result.skipped_count > 0
                  ? `${result.skipped_count} skipped (no email on file). `
                  : "") +
                "Open Approval Queue to review and send.",
            );
            setSelected(new Set());
          }}
        />
      )}
    </section>
  );
}
