import { useCallback, useEffect, useRef, useState } from "react";
import { client, QUOTATION_AGENT_URL } from "./api/client";
import { useAuth } from "./auth/AuthContext";
import {
  AppSidebar,
  type LeadsTableSection,
  type MailSection,
  type NavItem,
  type Tab,
} from "./components/AppSidebar";
import { InboxAlertToasts } from "./components/InboxAlertToasts";
import { InterestedFollowUpAlertToasts } from "./components/InterestedFollowUpAlertToasts";
import { EmailActivityPage } from "./pages/EmailActivityPage";
import { EmailTemplatesPage } from "./pages/EmailTemplatesPage";
import { WhatsAppTemplatesPage } from "./pages/WhatsAppTemplatesPage";
import { WhatsAppInboxPage } from "./pages/WhatsAppInboxPage";
import { BuyerProfile } from "./pages/BuyerProfile";
import { CallsPage } from "./pages/CallsPage";
import { ConsentPage } from "./pages/ConsentPage";
import { InboxPage } from "./pages/InboxPage";
import { LeadsPage } from "./pages/LeadsPage";
import { LeadsTablePage } from "./pages/LeadsTablePage";
import { ChatbotPage } from "./pages/ChatbotPage";
import { KpiPage } from "./pages/KpiPage";
import { LoginPage } from "./pages/LoginPage";
import { UsersPage } from "./pages/UsersPage";
import { TwilioVoiceProvider, useTwilioVoiceOptional } from "./hooks/useTwilioVoice";
import { PostCallRemarksModal } from "./components/PostCallRemarksModal";
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
        Refresh the page, or open Calls and try again in a moment. Railway may still be warming up.
      </p>
    </div>
  );
}

function DashboardApp() {
  const { user, isAdmin, logout } = useAuth();
  const [tab, setTab] = useState<Tab>("activity");
  const [tableSection, setTableSection] = useState<LeadsTableSection>("all");
  const [mailSection, setMailSection] = useState<MailSection>("inbox");
  const [tableCounts, setTableCounts] = useState({
    all: 0,
    old_clients: 0,
    interested_clients: 0,
    not_interested_clients: 0,
    not_received_call_clients: 0,
  });
  const [mailCounts, setMailCounts] = useState({
    inbox: 0,
    sent: 0,
    trash: 0,
    archive: 0,
  });
  const [leadsTableRefreshToken, setLeadsTableRefreshToken] = useState(0);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [emailActivityUnread, setEmailActivityUnread] = useState(0);
  const [emailTemplateCount, setEmailTemplateCount] = useState(0);
  const [whatsappTemplateCount, setWhatsappTemplateCount] = useState(0);
  const [discoverLeadsCount, setDiscoverLeadsCount] = useState(0);

  const [consentSummary, setConsentSummary] = useState<{ unknown: number } | null>(null);
  const [inboxUnread, setInboxUnread] = useState(0);
  const seenMessageUidsRef = useRef<Set<string> | null>(null);
  const seenFollowUpIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const onExpired = () => {
      void logout();
    };
    window.addEventListener("kafi:auth-expired", onExpired);
    return () => window.removeEventListener("kafi:auth-expired", onExpired);
  }, [logout]);

  useEffect(() => {
    if (!isAdmin && tab === "leads") {
      setTab("activity");
      setSelectedLeadId(null);
    }
    if (!isAdmin && tab === "users") {
      setTab("activity");
    }
  }, [isAdmin, tab]);

  const loadDiscoverLeadsCount = useCallback(async () => {
    if (!isAdmin) {
      setDiscoverLeadsCount(0);
      return;
    }
    try {
      const result = await client.listLeads({ page: 1, page_size: 1 });
      setDiscoverLeadsCount(result.total);
    } catch {
      setDiscoverLeadsCount(0);
    }
  }, [isAdmin]);

  const loadEmailTemplateCount = useCallback(async () => {
    try {
      const rows = await client.listEmailTemplates();
      setEmailTemplateCount(rows.length);
    } catch {
      setEmailTemplateCount(0);
    }
  }, []);

  const loadWhatsappTemplateCount = useCallback(async () => {
    try {
      const rows = await client.listWhatsAppTemplates();
      setWhatsappTemplateCount(rows.filter((t) => t.status === "approved").length);
    } catch {
      setWhatsappTemplateCount(0);
    }
  }, []);

  const loadTableCounts = useCallback(async () => {
    try {
      const counts = await client.getLeadsTableSectionCounts();
      setTableCounts(counts);
    } catch {
      /* optional badges */
    }
  }, []);

  const loadMailCounts = useCallback(async () => {
    try {
      const result = await client.listInboxFolders();
      const next = { inbox: 0, sent: 0, trash: 0, archive: 0 };
      for (const folder of result.folders) {
        if (folder.key === "inbox" || folder.key === "sent" || folder.key === "trash" || folder.key === "archive") {
          next[folder.key] = folder.count;
        }
      }
      setMailCounts(next);
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
            dueAt: reminder.due_at,
            daysSincePlacement: reminder.days_since_placement ?? 0,
            tableSection:
              reminder.table_section === "not_received_call_clients"
                ? "not_received_call_clients"
                : "interested_clients",
          });
        }
      })
      .catch(() => {
        /* optional */
      });
  }, []);

  const refreshAll = useCallback(() => {
    setError(null);
    void loadDiscoverLeadsCount();
    void loadTableCounts();
    void loadMailCounts();
    void loadEmailTemplateCount();
    void loadWhatsappTemplateCount();
    client.getConsentSummary().then(setConsentSummary).catch(() => setConsentSummary(null));
    client
      .getEmailActivityUnreadCount()
      .then((r) => setEmailActivityUnread(r.unread_count))
      .catch(() => setEmailActivityUnread(0));
    pollInbox();
    pollInterestedFollowUps();
  }, [
    loadDiscoverLeadsCount,
    loadEmailTemplateCount,
    loadWhatsappTemplateCount,
    loadMailCounts,
    loadTableCounts,
    pollInbox,
    pollInterestedFollowUps,
  ]);

  useEffect(() => {
    client.getConsentSummary().then(setConsentSummary).catch(() => setConsentSummary(null));
    void loadTableCounts();
    void loadMailCounts();
    void loadDiscoverLeadsCount();
    void loadEmailTemplateCount();
    void loadWhatsappTemplateCount();
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
  }, [
    loadDiscoverLeadsCount,
    loadEmailTemplateCount,
    loadWhatsappTemplateCount,
    loadMailCounts,
    loadTableCounts,
    pollInbox,
    pollInterestedFollowUps,
  ]);

  function handleSelectLead(leadId: number) {
    setError(null);
    setSelectedLeadId(leadId);
  }

  function handleBackFromProfile() {
    setSelectedLeadId(null);
    void loadDiscoverLeadsCount();
    void loadTableCounts();
    void loadMailCounts();
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

  function handleSelectMailSection(section: MailSection) {
    setMailSection(section);
  }

  const handleMailCountsChange = useCallback(
    (counts: {
      inbox: number;
      sent: number;
      trash: number;
      archive: number;
    }) => {
      setMailCounts(counts);
    },
    [],
  );

  function handleCallFollowUpSaved(_outcome: string | null | undefined) {
    void loadTableCounts();
    void loadEmailTemplateCount();
    setLeadsTableRefreshToken((token) => token + 1);
  }

  function handleViewInterestedClient(
    buyerId: number,
    section: LeadsTableSection = "interested_clients",
  ) {
    setTab("table");
    setTableSection(section);
    setSelectedLeadId(buyerId);
  }

  async function handleAcknowledgeInterestedFollowUp(buyerId: number) {
    await client.acknowledgeInterestedFollowUp(buyerId);
    const reminders = await client.listInterestedFollowUps();
    for (const reminder of reminders) {
      seenFollowUpIdsRef.current.add(reminder.id);
    }
    setLeadsTableRefreshToken((token) => token + 1);
  }

  const navItems: NavItem[] = [
    { id: "activity", label: "Email Activity", count: emailActivityUnread, alert: emailActivityUnread > 0 },
    { id: "email-templates", label: "Email templates", count: emailTemplateCount },
    { id: "whatsapp-templates", label: "WhatsApp templates", count: whatsappTemplateCount },
    { id: "whatsapp-inbox", label: "WhatsApp inbox", count: 0 },
    ...(isAdmin
      ? [{ id: "leads" as const, label: "Discover Leads", count: discoverLeadsCount }]
      : []),
    {
      id: "table",
      label: "Leads table",
      count: tableCounts.all,
      children: [
        { id: "old_clients", label: "Old clients", count: tableCounts.old_clients },
        {
          id: "interested_clients",
          label: "Follow up clients",
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
    {
      id: "inbox",
      label: "Mail",
      count: inboxUnread,
      alert: inboxUnread > 0,
      children: [
        { id: "inbox", label: "Inbox", count: mailCounts.inbox },
        { id: "sent", label: "Sent", count: mailCounts.sent },
        { id: "trash", label: "Trash", count: mailCounts.trash },
        { id: "archive", label: "Archive", count: mailCounts.archive },
      ],
    },
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
    { id: "kpi", label: "KPI Generation", count: 0 },
    ...(isAdmin ? [{ id: "users" as const, label: "Users", count: 0 }] : []),
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
        <InboxAlertToasts
          onOpenInbox={() => {
            setMailSection("inbox");
            handleSelectTab("inbox");
          }}
        />
        <InterestedFollowUpAlertToasts
          onViewClient={handleViewInterestedClient}
          onAcknowledge={handleAcknowledgeInterestedFollowUp}
        />
        <AppSidebar
          navItems={navItems}
          activeTab={tab}
          tableSection={tableSection}
          mailSection={mailSection}
          onSelectTab={handleSelectTab}
          onSelectTableSection={handleSelectTableSection}
          onSelectMailSection={handleSelectMailSection}
          onRefresh={refreshAll}
          userLabel={user?.full_name || user?.username}
          userRole={user?.role}
          onLogout={() => void logout()}
        />

        <div className="flex-1 min-w-0 overflow-x-hidden">
          <main className="max-w-6xl mx-auto px-8 py-8">
            <CallInitBanner />
            {error && (
              <div className="mb-7 p-4 rounded-lg bg-red-500/10 border border-red-500/30 text-red-200 text-sm">
                {error}
                <p className="mt-1 text-red-300/70">
                  If this keeps appearing, hard-refresh the page or log in again. On localhost,
                  make sure the backend is running (`cd backend && python run.py`) and restarted
                  after code changes.
                </p>
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
            {tab === "whatsapp-templates" && (
              <WhatsAppTemplatesPage
                onError={setError}
                onCountChange={setWhatsappTemplateCount}
              />
            )}
            {tab === "whatsapp-inbox" && <WhatsAppInboxPage onError={setError} />}
            {tab === "leads" && isAdmin && selectedLeadId !== null && (
              <BuyerProfile
                leadId={selectedLeadId}
                onBack={handleBackFromProfile}
                onError={setError}
                onCallFollowUpSaved={handleCallFollowUpSaved}
                canDiscover
              />
            )}
            {tab === "leads" && isAdmin && selectedLeadId === null && (
              <LeadsPage
                onError={setError}
                onSelectLead={handleSelectLead}
                onTotalChange={setDiscoverLeadsCount}
              />
            )}
            {tab === "table" && selectedLeadId !== null && (
              <BuyerProfile
                leadId={selectedLeadId}
                onBack={handleBackFromProfile}
                onError={setError}
                onCallFollowUpSaved={handleCallFollowUpSaved}
                canDiscover={isAdmin}
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
              <InboxPage
                section={mailSection}
                onError={setError}
                onUnreadChange={setInboxUnread}
                onFolderCountsChange={handleMailCountsChange}
              />
            )}
            {tab === "calls" && selectedLeadId !== null && (
              <BuyerProfile
                leadId={selectedLeadId}
                onBack={handleBackFromProfile}
                onError={setError}
                onCallFollowUpSaved={handleCallFollowUpSaved}
                canDiscover={isAdmin}
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
                canDiscover={isAdmin}
              />
            )}
            {tab === "compliance" && selectedLeadId === null && (
              <ConsentPage onError={setError} onSelectLead={handleSelectLead} />
            )}
            {tab === "chatbot" && <ChatbotPage onError={setError} />}
            {tab === "kpi" && <KpiPage onError={setError} />}
            {tab === "users" && isAdmin && <UsersPage onError={setError} />}
          </main>
        </div>
      </div>
    </TwilioVoiceProvider>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-400 text-sm">
        Checking session…
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <DashboardApp />;
}
