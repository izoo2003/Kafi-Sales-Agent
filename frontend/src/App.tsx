import { useCallback, useEffect, useRef, useState } from "react";
import { client, QUOTATION_AGENT_URL } from "./api/client";
import { AppSidebar, type LeadsTableSection, type NavItem, type Tab } from "./components/AppSidebar";
import { InboxAlertToasts } from "./components/InboxAlertToasts";
import { InterestedFollowUpAlertToasts } from "./components/InterestedFollowUpAlertToasts";
import { EmailActivityPage } from "./pages/EmailActivityPage";
import { EmailTemplatesPage } from "./pages/EmailTemplatesPage";
import { BuyerProfile } from "./pages/BuyerProfile";
import { CallsPage } from "./pages/CallsPage";
import { ConsentPage } from "./pages/ConsentPage";
import { InboxPage } from "./pages/InboxPage";
import { LeadsPage } from "./pages/LeadsPage";
import { LeadsTablePage } from "./pages/LeadsTablePage";
import { ChatbotPage } from "./pages/ChatbotPage";
import { TwilioVoiceProvider, useTwilioVoiceOptional } from "./hooks/useTwilioVoice";
import { PostCallRemarksModal } from "./components/PostCallRemarksModal";
import { useLeads } from "./hooks/useLeads";
import {
  alertInterestedFollowUp,
  alertNewInboxMessage,
  requestNotificationPermission,
  unlockNotificationAudio,
} from "./utils/notify";


const INBOX_POLL_INTERVAL_MS = 12_000;
const FOLLOW_UP_POLL_INTERVAL_MS = 60_000;

function CallInitBanner() {
  const voice = useTwilioVoiceOptional();
  if (!voice?.initError) return null;
  return (
    <div className="mb-7 p-4 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-100 text-sm">
      <p className="font-medium">Browser calling is not ready</p>
      <p className="mt-1 text-amber-200/80">{voice.initError}</p>
      <p className="mt-2 text-xs text-amber-200/60">
        Restart the backend after running: <code className="text-amber-100">pip install -r requirements.txt</code>
      </p>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState<Tab>("activity");
  const [tableSection, setTableSection] = useState<LeadsTableSection>("all");
  const [tableCounts, setTableCounts] = useState({
    all: 0,
    old_clients: 0,
    interested_clients: 0,
    not_interested_clients: 0,
    not_received_call_clients: 0,
  });
  const [leadsTableRefreshToken, setLeadsTableRefreshToken] = useState(0);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailActivityUnread, setEmailActivityUnread] = useState(0);
  const [emailTemplateCount, setEmailTemplateCount] = useState(0);
  const { leads, refresh: refreshLeads } = useLeads();

  const [consentSummary, setConsentSummary] = useState<{ unknown: number } | null>(null);
  const [inboxUnread, setInboxUnread] = useState(0);
  const seenMessageUidsRef = useRef<Set<string> | null>(null);
  const seenFollowUpIdsRef = useRef<Set<string>>(new Set());

  const loadEmailTemplateCount = useCallback(async () => {
    try {
      const rows = await client.listEmailTemplates();
      setEmailTemplateCount(rows.length);
    } catch {
      setEmailTemplateCount(0);
    }
  }, []);

  const loadTableCounts = useCallback(async () => {
    try {
      const [allResult, oldResult, interestedResult, notInterestedResult, notReceivedResult] =
        await Promise.all([
        client.listLeadsTable({
          exclude_source: "old_clients",
          sort_by: "company_name",
          sort_dir: "asc",
          page: 1,
          page_size: 1,
        }),
        client.listLeadsTable({
          source: "old_clients",
          sort_by: "company_name",
          sort_dir: "asc",
          page: 1,
          page_size: 1,
        }),
        client.listLeadsTable({
          call_outcome: "interested",
          sort_by: "company_name",
          sort_dir: "asc",
          page: 1,
          page_size: 1,
        }),
        client.listLeadsTable({
          call_outcome: "not_interested",
          sort_by: "company_name",
          sort_dir: "asc",
          page: 1,
          page_size: 1,
        }),
        client.listLeadsTable({
          call_outcome: "not_received_call",
          sort_by: "company_name",
          sort_dir: "asc",
          page: 1,
          page_size: 1,
        }),
      ]);
      setTableCounts({
        all: allResult.total,
        old_clients: oldResult.total,
        interested_clients: interestedResult.total,
        not_interested_clients: notInterestedResult.total,
        not_received_call_clients: notReceivedResult.total,
      });
    } catch {
      /* optional badges */
    }
  }, []);

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

  const pollInterestedFollowUps = useCallback(() => {
    client
      .listInterestedFollowUps()
      .then((reminders) => {
        const seen = seenFollowUpIdsRef.current;
        for (const reminder of reminders) {
          if (seen.has(reminder.id)) continue;
          seen.add(reminder.id);
          alertInterestedFollowUp({
            id: reminder.id,
            buyerId: reminder.buyer_id,
            companyName: reminder.company_name,
            contactName: reminder.contact_name,
            weeksSincePlacement: reminder.weeks_since_placement,
          });
        }
      })
      .catch(() => {
        /* optional */
      });
  }, []);

  const refreshAll = useCallback(() => {
    setError(null);
    refreshLeads();
    void loadTableCounts();
    void loadEmailTemplateCount();
    client.getConsentSummary().then(setConsentSummary).catch(() => setConsentSummary(null));
    client
      .getEmailActivityUnreadCount()
      .then((r) => setEmailActivityUnread(r.unread_count))
      .catch(() => setEmailActivityUnread(0));
    pollInbox();
    pollInterestedFollowUps();
  }, [loadEmailTemplateCount, loadTableCounts, refreshLeads, pollInbox, pollInterestedFollowUps]);

  useEffect(() => {
    client.getConsentSummary().then(setConsentSummary).catch(() => setConsentSummary(null));
    void loadTableCounts();
    void loadEmailTemplateCount();
    requestNotificationPermission();

    const unlock = () => unlockNotificationAudio();
    window.addEventListener("click", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });

    pollInbox();
    pollInterestedFollowUps();
    client
      .getEmailActivityUnreadCount()
      .then((r) => setEmailActivityUnread(r.unread_count))
      .catch(() => setEmailActivityUnread(0));
    const inboxTimer = window.setInterval(pollInbox, INBOX_POLL_INTERVAL_MS);
    const followUpTimer = window.setInterval(pollInterestedFollowUps, FOLLOW_UP_POLL_INTERVAL_MS);
    const activityTimer = window.setInterval(() => {
      client
        .getEmailActivityUnreadCount()
        .then((r) => setEmailActivityUnread(r.unread_count))
        .catch(() => undefined);
    }, INBOX_POLL_INTERVAL_MS);
    return () => {
      window.clearInterval(inboxTimer);
      window.clearInterval(followUpTimer);
      window.clearInterval(activityTimer);
      window.removeEventListener("click", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [loadEmailTemplateCount, loadTableCounts, pollInbox, pollInterestedFollowUps]);

  function handleSelectLead(leadId: number) {
    setError(null);
    setSelectedLeadId(leadId);
  }

  function handleBackFromProfile() {
    setSelectedLeadId(null);
    refreshLeads();
    void loadTableCounts();
    void loadEmailTemplateCount();
  }

  function handleSelectTab(nextTab: Tab) {
    setTab(nextTab);
    if (nextTab !== "leads" && nextTab !== "table" && nextTab !== "calls") {
      setSelectedLeadId(null);
    }
  }

  function handleSelectTableSection(section: LeadsTableSection) {
    setTableSection(section);
    setSelectedLeadId(null);
  }

  function handleCallFollowUpSaved(_outcome: string | null | undefined) {
    void loadTableCounts();
    void loadEmailTemplateCount();
    setLeadsTableRefreshToken((token) => token + 1);
  }

  function handleViewInterestedClient(buyerId: number) {
    setTab("table");
    setTableSection("interested_clients");
    setSelectedLeadId(buyerId);
  }

  async function handleAcknowledgeInterestedFollowUp(buyerId: number) {
    await client.acknowledgeInterestedFollowUp(buyerId);
    const reminders = await client.listInterestedFollowUps();
    for (const reminder of reminders) {
      seenFollowUpIdsRef.current.add(reminder.id);
    }
  }

  const navItems: NavItem[] = [
    { id: "activity", label: "Email Activity", count: emailActivityUnread, alert: emailActivityUnread > 0 },
    { id: "email-templates", label: "Email templates", count: emailTemplateCount },
    { id: "leads", label: "Discover Leads", count: leads.length },
    {
      id: "table",
      label: "Leads table",
      count: tableCounts.all,
      children: [
        { id: "old_clients", label: "Old clients", count: tableCounts.old_clients },
        {
          id: "interested_clients",
          label: "Interested clients",
          count: tableCounts.interested_clients,
        },
        {
          id: "not_interested_clients",
          label: "Not interested",
          count: tableCounts.not_interested_clients,
        },
        {
          id: "not_received_call_clients",
          label: "Did not receive call",
          count: tableCounts.not_received_call_clients,
        },
      ],
    },
    { id: "inbox", label: "Inbox", count: inboxUnread, alert: inboxUnread > 0 },
    { id: "calls", label: "Calls", count: 0 },
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
    { id: "chatbot", label: "Brand assistant", count: 0 },
  ];

  return (
    <TwilioVoiceProvider>
      <PostCallRemarksModal
        onError={setError}
        onSaved={(outcome) => {
          handleCallFollowUpSaved(outcome);
        }}
      />
      <div className="min-h-screen flex">
        <InboxAlertToasts onOpenInbox={() => handleSelectTab("inbox")} />
        <InterestedFollowUpAlertToasts
          onViewClient={handleViewInterestedClient}
          onAcknowledge={handleAcknowledgeInterestedFollowUp}
        />
        <AppSidebar
          navItems={navItems}
          activeTab={tab}
          tableSection={tableSection}
          onSelectTab={handleSelectTab}
          onSelectTableSection={handleSelectTableSection}
          onRefresh={refreshAll}
        />

        <div className="flex-1 min-w-0 overflow-x-hidden">
          <main className="max-w-6xl mx-auto px-8 py-8">
            <CallInitBanner />
            {error && (
              <div className="mb-7 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-200 text-sm">
                {error}
                <p className="mt-1 text-red-300/70">Is the backend running? (python run.py)</p>
              </div>
            )}

            {tab === "activity" && (
              <EmailActivityPage onError={setError} onUnreadChange={setEmailActivityUnread} />
            )}
            {tab === "email-templates" && (
              <EmailTemplatesPage
                onError={setError}
                onCountChange={setEmailTemplateCount}
              />
            )}
            {tab === "leads" && selectedLeadId !== null && (
              <BuyerProfile
                leadId={selectedLeadId}
                onBack={handleBackFromProfile}
                onError={setError}
                onCallFollowUpSaved={handleCallFollowUpSaved}
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
                onCallFollowUpSaved={handleCallFollowUpSaved}
              />
            )}
            {tab === "table" && selectedLeadId === null && (
              <LeadsTablePage
                section={tableSection}
                refreshToken={leadsTableRefreshToken}
                onError={setError}
                onSelectLead={handleSelectLead}
                onSectionCountsChange={setTableCounts}
              />
            )}
            {tab === "inbox" && (
              <InboxPage onError={setError} onUnreadChange={setInboxUnread} />
            )}
            {tab === "calls" && selectedLeadId !== null && (
              <BuyerProfile
                leadId={selectedLeadId}
                onBack={handleBackFromProfile}
                onError={setError}
                onCallFollowUpSaved={handleCallFollowUpSaved}
              />
            )}
            {tab === "calls" && selectedLeadId === null && (
              <CallsPage
                onError={setError}
                onSelectLead={handleSelectLead}
                onCallFollowUpSaved={handleCallFollowUpSaved}
              />
            )}
            {tab === "compliance" && selectedLeadId !== null && (
              <BuyerProfile
                leadId={selectedLeadId}
                onBack={handleBackFromProfile}
                onError={setError}
                onCallFollowUpSaved={handleCallFollowUpSaved}
              />
            )}
            {tab === "compliance" && selectedLeadId === null && (
              <ConsentPage onError={setError} onSelectLead={handleSelectLead} />
            )}
            {tab === "chatbot" && <ChatbotPage onError={setError} />}
          </main>
        </div>
      </div>
    </TwilioVoiceProvider>
  );
}
