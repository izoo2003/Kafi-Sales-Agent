import { useCallback, useMemo, useState } from "react";
import { client, type DiscoveryCandidate, type Lead } from "../api/client";

interface DiscoverLeadsPanelProps {
  seedLead?: Lead | null;
  seedCategories?: string[];
  onImported: (createdIds: number[]) => void;
  onError: (message: string) => void;
  onCancel?: () => void;
}

function sourceLabel(source: string): string {
  switch (source) {
    case "web_search":
      return "Web search";
    case "website_links":
      return "Website links";
    case "csv":
      return "CSV";
    default:
      return source;
  }
}

export function DiscoverLeadsPanel({
  seedLead,
  seedCategories = [],
  onImported,
  onError,
  onCancel,
}: DiscoverLeadsPanelProps) {
  const [country, setCountry] = useState(seedLead?.country ?? "");
  const [industry, setIndustry] = useState(seedLead?.industry ?? "");
  const [limit, setLimit] = useState(15);
  const [useWebSearch, setUseWebSearch] = useState(true);
  const [useWebsiteLinks, setUseWebsiteLinks] = useState(true);
  const [autoOnboard, setAutoOnboard] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [importing, setImporting] = useState(false);
  const [candidates, setCandidates] = useState<DiscoveryCandidate[]>([]);
  const [messages, setMessages] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string | null>(null);
  const [sourcesUsed, setSourcesUsed] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const importable = useMemo(
    () => candidates.filter((c) => !c.already_exists),
    [candidates],
  );

  const handleDiscover = useCallback(async () => {
    setDiscovering(true);
    setMessages([]);
    try {
      const result = await client.discoverLeads({
        seed_lead_id: seedLead?.id,
        country: country.trim() || undefined,
        industry: industry.trim() || undefined,
        categories: seedCategories,
        limit,
        use_web_search: useWebSearch,
        use_website_links: useWebsiteLinks,
      });
      setCandidates(result.candidates);
      setMessages(result.messages);
      setSearchQuery(result.search_query);
      setSourcesUsed(result.sources_used);
      setSelected(
        new Set(result.candidates.filter((c) => !c.already_exists).map((c) => c.candidate_id)),
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Discovery failed");
    } finally {
      setDiscovering(false);
    }
  }, [
    country,
    industry,
    limit,
    onError,
    seedCategories,
    seedLead?.id,
    useWebSearch,
    useWebsiteLinks,
  ]);

  async function handleCsvUpload(file: File) {
    setDiscovering(true);
    setMessages([]);
    try {
      const result = await client.discoverLeadsFromCsv(
        file,
        country.trim() || undefined,
      );
      setCandidates(result.candidates);
      setMessages(result.messages);
      setSearchQuery(result.search_query);
      setSourcesUsed(result.sources_used);
      setSelected(
        new Set(result.candidates.filter((c) => !c.already_exists).map((c) => c.candidate_id)),
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "CSV import failed");
    } finally {
      setDiscovering(false);
    }
  }

  async function handleImport() {
    const toImport = candidates.filter((c) => selected.has(c.candidate_id) && !c.already_exists);
    if (toImport.length === 0) {
      onError("Select at least one new candidate to import");
      return;
    }
    setImporting(true);
    try {
      const result = await client.importDiscoveredLeads({
        candidates: toImport.map((c) => ({
          company_name: c.company_name,
          website_url: c.website_url ?? undefined,
          country: c.country ?? undefined,
          industry: c.industry ?? undefined,
          source: c.source,
        })),
        auto_onboard: autoOnboard,
      });
      onImported(result.created.map((b) => b.id));
      setCandidates((prev) =>
        prev.map((c) =>
          toImport.some((i) => i.candidate_id === c.candidate_id)
            ? { ...c, already_exists: true }
            : c,
        ),
      );
      setSelected(new Set());
      setMessages([
        `Imported ${result.created_count} lead(s).`,
        ...(result.skipped_count > 0 ? [`Skipped ${result.skipped_count} duplicate(s).`] : []),
      ]);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelected(new Set(importable.map((c) => c.candidate_id)));
    } else {
      setSelected(new Set());
    }
  }

  function toggleOne(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900 p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-medium text-slate-200">Discover leads</h3>
          <p className="text-xs text-slate-500 mt-1">
            Find similar importers and distributors. Preview before adding — no auto-outreach.
          </p>
        </div>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-slate-400 hover:text-slate-200"
          >
            Close
          </button>
        )}
      </div>

      {seedLead && (
        <p className="text-xs text-slate-500 rounded-lg bg-slate-950 border border-slate-800 px-3 py-2">
          Seed: <span className="text-slate-300">{seedLead.company_name}</span>
          {seedCategories.length > 0 && (
            <span> · {seedCategories.length} matched product categor{seedCategories.length === 1 ? "y" : "ies"}</span>
          )}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-slate-400">
          Country / market
          <input
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="e.g. UAE, UK, Saudi Arabia"
            className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
          />
        </label>
        <label className="block text-xs text-slate-400">
          Industry
          <input
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            placeholder="e.g. Food importer, Wholesale"
            className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-sm text-slate-400">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={useWebSearch}
            onChange={(e) => setUseWebSearch(e.target.checked)}
          />
          Web search (needs SERPAPI_API_KEY)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={useWebsiteLinks}
            onChange={(e) => setUseWebsiteLinks(e.target.checked)}
            disabled={!seedLead?.website_url}
          />
          Partner links from seed website
        </label>
        <label className="flex items-center gap-2">
          Limit
          <input
            type="number"
            min={1}
            max={30}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="w-16 rounded bg-slate-950 border border-slate-700 px-2 py-1 text-sm"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleDiscover}
          disabled={discovering}
          className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
        >
          {discovering ? "Searching…" : "Find similar leads"}
        </button>
        <label className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm cursor-pointer">
          Upload CSV
          <input
            type="file"
            accept=".csv"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleCsvUpload(file);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {(messages.length > 0 || searchQuery) && (
        <div className="text-xs text-slate-500 space-y-1 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">
          {searchQuery && (
            <p>
              Search query: <span className="text-slate-400">{searchQuery}</span>
            </p>
          )}
          {sourcesUsed.length > 0 && (
            <p>Sources: {sourcesUsed.map(sourceLabel).join(", ")}</p>
          )}
          {messages.map((msg) => (
            <p key={msg}>{msg}</p>
          ))}
        </div>
      )}

      {candidates.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-800 bg-slate-950">
                  <th className="py-2 px-3 w-10">
                    <input
                      type="checkbox"
                      checked={importable.length > 0 && selected.size === importable.length}
                      onChange={(e) => toggleAll(e.target.checked)}
                      aria-label="Select all"
                    />
                  </th>
                  <th className="py-2 pr-4">Company</th>
                  <th className="py-2 pr-4">Website</th>
                  <th className="py-2 pr-4">Market</th>
                  <th className="py-2 pr-4">Source</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((candidate) => (
                  <tr key={candidate.candidate_id} className="border-b border-slate-800/60">
                    <td className="py-2 px-3">
                      <input
                        type="checkbox"
                        checked={selected.has(candidate.candidate_id)}
                        disabled={candidate.already_exists}
                        onChange={(e) => toggleOne(candidate.candidate_id, e.target.checked)}
                      />
                    </td>
                    <td className="py-2 pr-4 text-slate-200">{candidate.company_name}</td>
                    <td className="py-2 pr-4 text-slate-400 max-w-[200px] truncate">
                      {candidate.website_url ? (
                        <a
                          href={candidate.website_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-400 hover:text-emerald-300"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {candidate.website_url.replace(/^https?:\/\//, "")}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="py-2 pr-4 text-slate-400">
                      {[candidate.country, candidate.industry].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="py-2 pr-4 text-slate-500 text-xs">
                      {sourceLabel(candidate.source)}
                    </td>
                    <td className="py-2 text-xs">
                      {candidate.already_exists ? (
                        <span className="text-amber-400/90">Already in leads</span>
                      ) : (
                        <span className="text-slate-500">New</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-400">
              <input
                type="checkbox"
                checked={autoOnboard}
                onChange={(e) => setAutoOnboard(e.target.checked)}
              />
              Research &amp; score after import
            </label>
            <button
              type="button"
              onClick={handleImport}
              disabled={importing || selected.size === 0}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
            >
              {importing ? "Importing…" : `Add selected (${selected.size})`}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
