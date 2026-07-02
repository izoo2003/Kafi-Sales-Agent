import { useState, type MouseEvent } from "react";
import { client } from "../api/client";
import { CreateLeadForm } from "../components/CreateLeadForm";
import { DiscoverLeadsPanel } from "../components/DiscoverLeadsPanel";
import { ScoreBadge } from "../components/ScoreBadge";
import { useLeads } from "../hooks/useLeads";

interface LeadsPageProps {
  onError: (message: string) => void;
  onSelectLead: (leadId: number) => void;
}

export function LeadsPage({ onError, onSelectLead }: LeadsPageProps) {
  const { leads, loading, refresh } = useLeads();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [showDiscover, setShowDiscover] = useState(false);
  const [onboardResult, setOnboardResult] = useState<
    Record<number, { score: string; reasoning: string }>
  >({});
  const [onboarding, setOnboarding] = useState<number | null>(null);

  async function handleOnboard(leadId: number, event: MouseEvent) {
    event.stopPropagation();
    setOnboarding(leadId);
    try {
      const result = await client.onboardLead(leadId);
      setOnboardResult((prev) => ({
        ...prev,
        [leadId]: { score: result.score, reasoning: result.reasoning },
      }));
      refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Onboard failed");
    } finally {
      setOnboarding(null);
    }
  }

  async function handleLeadCreated(leadId: number) {
    setShowCreateForm(false);
    await refresh();
    onSelectLead(leadId);
  }

  if (loading) return <p className="text-slate-400">Loading leads…</p>;

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-400">
          {leads.length} lead{leads.length === 1 ? "" : "s"}
        </p>
        {!showCreateForm && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowDiscover((v) => !v);
                setShowCreateForm(false);
              }}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm"
            >
              {showDiscover ? "Hide discovery" : "Discover leads"}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowCreateForm(true);
                setShowDiscover(false);
              }}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
            >
              + Add lead
            </button>
          </div>
        )}
      </div>

      {showDiscover && (
        <DiscoverLeadsPanel
          onImported={async (ids) => {
            await refresh();
            if (ids.length === 1) onSelectLead(ids[0]);
          }}
          onError={onError}
          onCancel={() => setShowDiscover(false)}
        />
      )}

      {showCreateForm && (
        <CreateLeadForm
          onSuccess={handleLeadCreated}
          onCancel={() => setShowCreateForm(false)}
          onError={onError}
        />
      )}

      {leads.length === 0 && !showCreateForm && (
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-8 text-center">
          <p className="text-slate-400 text-sm">No leads yet.</p>
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="mt-3 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium"
          >
            Add your first lead
          </button>
        </div>
      )}

      {leads.map((lead) => {
        const result = onboardResult[lead.id];
        return (
          <div
            key={lead.id}
            role="button"
            tabIndex={0}
            onClick={() => onSelectLead(lead.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onSelectLead(lead.id);
            }}
            className="rounded-xl border border-slate-800 bg-slate-900 p-4 flex items-center justify-between gap-4 cursor-pointer hover:border-slate-700 hover:bg-slate-900/80 transition"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="font-medium">{lead.company_name}</h3>
                {result && <ScoreBadge score={result.score} />}
              </div>
              <p className="text-sm text-slate-400">
                {[lead.country, lead.industry].filter(Boolean).join(" · ") || "—"}
              </p>
              {result && (
                <p className="text-sm text-slate-500 mt-1 line-clamp-2">{result.reasoning}</p>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => handleOnboard(lead.id, e)}
              disabled={onboarding === lead.id}
              className="shrink-0 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm disabled:opacity-50"
            >
              {onboarding === lead.id ? "Scoring…" : "Quick score"}
            </button>
          </div>
        );
      })}
    </section>
  );
}
