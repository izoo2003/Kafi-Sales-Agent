import { useCallback, useEffect, useState } from "react";
import { client, QUOTATION_AGENT_URL } from "./api/client";
import { AppSidebar } from "./components/AppSidebar";
import { ApprovalQueue } from "./pages/ApprovalQueue";
import { BuyerProfile } from "./pages/BuyerProfile";
import { ConsentPage } from "./pages/ConsentPage";
import { BulkEmailPage } from "./pages/BulkEmailPage";
import { LeadsPage } from "./pages/LeadsPage";
import { LeadsTablePage } from "./pages/LeadsTablePage";
import { QuotationsPage } from "./pages/QuotationsPage";
import { useDrafts } from "./hooks/useDrafts";
import { useLeads } from "./hooks/useLeads";

type Tab = "drafts" | "leads" | "table" | "bulk-email" | "quotations" | "compliance";

type NavItem =
  | { id: Tab; label: string; count: number; external?: undefined }
  | { id: "quotation-agent"; label: string; count: number; external: string };

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

  function handleSelectTab(nextTab: Tab) {
    setTab(nextTab);
    if (nextTab !== "leads" && nextTab !== "table") setSelectedLeadId(null);
  }

  const navItems: NavItem[] = [
    { id: "drafts", label: "Approval Queue", count: drafts.length },
    { id: "leads", label: "Discover Leads", count: leads.length },
    { id: "table", label: "Leads table", count: leads.length },
    { id: "bulk-email", label: "Bulk email", count: 0 },
    { id: "quotations", label: "Product outreach", count: 0 },
    {
      id: "quotation-agent",
      label: "Quotation agent",
      count: 0,
      external: QUOTATION_AGENT_URL,
    },
    {
      id: "compliance",
      label: "Automated messages",
      count: consentSummary?.unknown ?? 0,
    },
  ];

  return (
    <div className="min-h-screen flex">
      <AppSidebar
        navItems={navItems}
        activeTab={tab}
        onSelectTab={handleSelectTab}
        onRefresh={refreshAll}
      />

      <div className="flex-1 min-w-0 overflow-x-hidden">
        <main className="max-w-6xl mx-auto px-8 py-8">
          {error && (
            <div className="mb-7 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-200 text-sm">
              {error}
              <p className="mt-1 text-red-300/70">Is the backend running? (python run.py)</p>
            </div>
          )}

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
          {tab === "bulk-email" && <BulkEmailPage onError={setError} />}
          {tab === "quotations" && <QuotationsPage onError={setError} />}
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
    </div>
  );
}
