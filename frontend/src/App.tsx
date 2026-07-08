import { useCallback, useEffect, useRef, useState } from "react";
import { client, QUOTATION_AGENT_URL } from "./api/client";
import { AppSidebar } from "./components/AppSidebar";
import { InboxAlertToasts } from "./components/InboxAlertToasts";
import { ApprovalQueue } from "./pages/ApprovalQueue";
import { BuyerProfile } from "./pages/BuyerProfile";
import { ConsentPage } from "./pages/ConsentPage";
import { BulkEmailPage } from "./pages/BulkEmailPage";
import { InboxPage } from "./pages/InboxPage";
import { LeadsPage } from "./pages/LeadsPage";
import { LeadsTablePage } from "./pages/LeadsTablePage";
import { QuotationsPage } from "./pages/QuotationsPage";
import { useDrafts } from "./hooks/useDrafts";
import { useLeads } from "./hooks/useLeads";
import {
  alertNewInboxMessage,
  requestNotificationPermission,
  unlockNotificationAudio,
} from "./utils/notify";

type Tab = "drafts" | "leads" | "table" | "inbox" | "bulk-email" | "quotations" | "compliance";

const INBOX_POLL_INTERVAL_MS = 12_000;

type NavItem =
  | { id: Tab; label: string; count: number; alert?: boolean; external?: undefined }
  | { id: "quotation-agent"; label: string; count: number; external: string };

export default function App() {
  const [tab, setTab] = useState<Tab>("drafts");
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { drafts, refresh: refreshDrafts } = useDrafts();
  const { leads, refresh: refreshLeads } = useLeads();

  const [consentSummary, setConsentSummary] = useState<{ unknown: number } | null>(null);
  const [inboxUnread, setInboxUnread] = useState(0);
  const seenMessageUidsRef = useRef<Set<string> | null>(null);

  const pollInbox = useCallback(() => {
    client
      .getInboxStatus()
      .then((status) => {
        if (!status.configured) {
          seenMessageUidsRef.current = null;
          setInboxUnread(0);
          return;
        }
        setInboxUnread(status.unread_count);
        return client.listInboxMessages({ limit: 25 }).then((messages) => {
          const currentUids = new Set(messages.map((m) => m.uid));
          const seen = seenMessageUidsRef.current;

          if (seen === null) {
            seenMessageUidsRef.current = currentUids;
            return;
          }

          const newMessages = messages.filter((m) => !seen.has(m.uid));
          if (newMessages.length > 0) {
            const first = newMessages[0];
            alertNewInboxMessage({
              from: first.from_name || first.from_email,
              subject: first.subject,
              count: newMessages.length,
            });
          }

          seenMessageUidsRef.current = currentUids;
        });
      })
      .catch(() => {
        /* mailbox may be unconfigured — ignore */
      });
  }, []);

  const refreshAll = useCallback(() => {
    setError(null);
    refreshDrafts();
    refreshLeads();
    client.getConsentSummary().then(setConsentSummary).catch(() => setConsentSummary(null));
    pollInbox();
  }, [refreshDrafts, refreshLeads, pollInbox]);

  useEffect(() => {
    client.getConsentSummary().then(setConsentSummary).catch(() => setConsentSummary(null));
    requestNotificationPermission();

    const unlock = () => unlockNotificationAudio();
    window.addEventListener("click", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    pollInbox();
    const timer = window.setInterval(pollInbox, INBOX_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [pollInbox]);

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
    if (nextTab !== "leads" && nextTab !== "table") {
      setSelectedLeadId(null);
    }
  }

  const navItems: NavItem[] = [
    { id: "drafts", label: "Approval Queue", count: drafts.length },
    { id: "leads", label: "Discover Leads", count: leads.length },
    { id: "table", label: "Leads table", count: leads.length },
    { id: "inbox", label: "Inbox", count: inboxUnread, alert: inboxUnread > 0 },
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
      <InboxAlertToasts onOpenInbox={() => handleSelectTab("inbox")} />
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
          {tab === "inbox" && (
            <InboxPage onError={setError} onUnreadChange={setInboxUnread} />
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
