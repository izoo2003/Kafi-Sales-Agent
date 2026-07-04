import { useCallback, useEffect, useState } from "react";
import { client } from "./api/client";
import { AppHeader } from "./components/AppHeader";
import { ApprovalQueue } from "./pages/ApprovalQueue";
import { BuyerProfile } from "./pages/BuyerProfile";
import { ConsentPage } from "./pages/ConsentPage";
import { FormalQuotationsPage } from "./pages/FormalQuotationsPage";
import { LeadsPage } from "./pages/LeadsPage";
import { LeadsTablePage } from "./pages/LeadsTablePage";
import { QuotationsPage } from "./pages/QuotationsPage";
import { useDrafts } from "./hooks/useDrafts";
import { useLeads } from "./hooks/useLeads";

type Tab = "drafts" | "leads" | "table" | "quotations" | "formal" | "compliance";

export default function App() {
  const [tab, setTab] = useState<Tab>("drafts");
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { drafts, refresh: refreshDrafts } = useDrafts();
  const { leads, refresh: refreshLeads } = useLeads();

  const [consentSummary, setConsentSummary] = useState<{ unknown: number } | null>(null);

  const refreshAll = useCallback(() => {
    setError(null);
    refreshDrafts();
    refreshLeads();
    client.getConsentSummary().then(setConsentSummary).catch(() => setConsentSummary(null));
  }, [refreshDrafts, refreshLeads]);

  useEffect(() => {
    client.getConsentSummary().then(setConsentSummary).catch(() => setConsentSummary(null));
  }, []);

  function handleSelectLead(leadId: number) {
    setError(null);
    setSelectedLeadId(leadId);
  }

  function handleBackFromProfile() {
    setSelectedLeadId(null);
    refreshLeads();
  }

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "drafts", label: "Approval Queue", count: drafts.length },
    { id: "leads", label: "Leads", count: leads.length },
    { id: "table", label: "Leads table", count: leads.length },
    { id: "quotations", label: "Product outreach", count: 0 },
    { id: "formal", label: "Quotations", count: 0 },
    {
      id: "compliance",
      label: "Consent",
      count: consentSummary?.unknown ?? 0,
    },
  ];

  return (
    <div className="min-h-screen">
      <AppHeader onRefresh={refreshAll} />

      <main className="max-w-7xl mx-auto px-20 py-8">
        {error && (
          <div className="mb-7 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-200 text-sm">
            {error}
            <p className="mt-1 text-red-300/70">Is the backend running? (python run.py)</p>
          </div>
        )}

        <nav className="flex gap-2 mb-8">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                if (t.id !== "leads" && t.id !== "table") setSelectedLeadId(null);
              }}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition ${
                tab === t.id
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {t.label}
              <span className="ml-2 opacity-70">({t.count})</span>
            </button>
          ))}
        </nav>

        {tab === "drafts" && <ApprovalQueue onError={setError} />}
        {tab === "leads" && selectedLeadId !== null && (
          <BuyerProfile
            leadId={selectedLeadId}
            onBack={handleBackFromProfile}
            onError={setError}
          />
        )}
        {tab === "leads" && selectedLeadId === null && (
          <LeadsPage onError={setError} onSelectLead={handleSelectLead} />
        )}
        {tab === "table" && selectedLeadId !== null && (
          <BuyerProfile
            leadId={selectedLeadId}
            onBack={handleBackFromProfile}
            onError={setError}
          />
        )}
        {tab === "table" && selectedLeadId === null && (
          <LeadsTablePage onError={setError} onSelectLead={handleSelectLead} />
        )}
        {tab === "quotations" && <QuotationsPage onError={setError} />}
        {tab === "formal" && <FormalQuotationsPage onError={setError} />}
        {tab === "compliance" && selectedLeadId !== null && (
          <BuyerProfile
            leadId={selectedLeadId}
            onBack={handleBackFromProfile}
            onError={setError}
          />
        )}
        {tab === "compliance" && selectedLeadId === null && (
          <ConsentPage onError={setError} onSelectLead={handleSelectLead} />
        )}
      </main>
    </div>
  );
}
