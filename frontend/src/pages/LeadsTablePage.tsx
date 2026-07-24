import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CountrySelect } from "../components/CountrySelect";
import type {
  LeadsTableSection,
} from "../components/AppSidebar";
import {
  assignedUserIdFromSection,
  isAssignedLeadsSection,
} from "../components/AppSidebar";
import { formatCountryLabel } from "../data/countries";
import { ScoreBadge } from "../components/ScoreBadge";
import { MarketRoleBadge } from "../components/MarketRoleBadge";
import { CallRecommendationBadge } from "../components/CallRecommendationBadge";
import { ProducerTierBadge } from "../components/ProducerTierBadge";
import { AssignedToSelect, type AssigneeOption } from "../components/AssignedToSelect";
import { FollowUpScheduleControl } from "../components/FollowUpScheduleControl";
import { LeadsTableCsvImport } from "../components/LeadsTableCsvImport";
import { SocialLinksCell } from "../components/SocialLinksCell";
import { BulkEmailModal } from "../components/BulkEmailModal";
import { BulkWhatsAppModal } from "../components/BulkWhatsAppModal";
import {
  BulkActionProgressPanel,
  type BulkActionProgress,
} from "../components/BulkActionProgressPanel";
import { CallLeadButton } from "../components/CallLeadButton";
import { EmailComposeButton } from "../components/EmailComposeLink";
import { Pagination } from "../components/Pagination";
import { exportLeadsTableCsv } from "../utils/exportCsv";
import { UNASSIGNED } from "../utils/leadAssignees";
import {
  client,
  type LeadTableFilters,
  type LeadTableRow,
  type LeadTableRowUpdate,
  type LeadTableSectionCountsResponse,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";

const TABLE_PAGE_SIZE = 20;
const TABLE_VIEW_STORAGE_PREFIX = "kafi_leads_table_view";

interface LeadsTablePageProps {
  section: LeadsTableSection;
  refreshToken?: number;
  onError: (message: string) => void;
  onSelectLead: (leadId: number) => void;
  onSectionCountsChange?: (counts: LeadTableSectionCountsResponse) => void;
}

type SortField =
  | "created_at"
  | "company_name"
  | "country"
  | "latest_score"
  | "market_role";

interface StoredTableView {
  score: string;
  marketRole: string;
  country: string;
  industry: string;
  companyGrading: string;
  productInterest: string;
  city: string;
  callRecommended: string;
  search: string;
  sortBy: SortField;
  sortDir: "asc" | "desc";
}

const DEFAULT_TABLE_VIEW: StoredTableView = {
  score: "",
  marketRole: "",
  country: "",
  industry: "",
  companyGrading: "",
  productInterest: "",
  city: "",
  callRecommended: "",
  search: "",
  sortBy: "created_at",
  sortDir: "desc",
};

function formatAddedAt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function tableViewStorageKey(userId: number | undefined, section: LeadsTableSection): string {
  return `${TABLE_VIEW_STORAGE_PREFIX}:${userId ?? "anonymous"}:${section}`;
}

function readStoredTableView(
  userId: number | undefined,
  section: LeadsTableSection,
): StoredTableView {
  try {
    const raw = sessionStorage.getItem(tableViewStorageKey(userId, section));
    if (!raw) return { ...DEFAULT_TABLE_VIEW };
    const parsed = JSON.parse(raw) as Partial<StoredTableView>;
    const validSortFields: SortField[] = [
      "created_at",
      "company_name",
      "country",
      "latest_score",
      "market_role",
    ];
    return {
      score: typeof parsed.score === "string" ? parsed.score : "",
      marketRole: typeof parsed.marketRole === "string" ? parsed.marketRole : "",
      country: typeof parsed.country === "string" ? parsed.country : "",
      industry: typeof parsed.industry === "string" ? parsed.industry : "",
      companyGrading:
        typeof parsed.companyGrading === "string" ? parsed.companyGrading : "",
      productInterest:
        typeof parsed.productInterest === "string" ? parsed.productInterest : "",
      city: typeof parsed.city === "string" ? parsed.city : "",
      callRecommended:
        typeof parsed.callRecommended === "string" ? parsed.callRecommended : "",
      search: typeof parsed.search === "string" ? parsed.search : "",
      sortBy:
        parsed.sortBy && validSortFields.includes(parsed.sortBy)
          ? parsed.sortBy
          : DEFAULT_TABLE_VIEW.sortBy,
      sortDir: parsed.sortDir === "asc" || parsed.sortDir === "desc"
        ? parsed.sortDir
        : DEFAULT_TABLE_VIEW.sortDir,
    };
  } catch {
    return { ...DEFAULT_TABLE_VIEW };
  }
}

const EDIT_INPUT =
  "w-full min-w-0 rounded-md bg-slate-950 border border-slate-700 px-2 py-1 text-sm text-slate-200";

const TH = "py-3 px-3 text-left whitespace-nowrap align-middle";
const TD = "py-3 px-3 align-middle";
const TD_MUTED = `${TD} text-slate-400`;
const TD_PRIMARY = `${TD} text-slate-200 font-medium`;

const MAX_BULK_ONBOARD = 25;
const BULK_ONBOARD_DELAY_MS = 1000;
const BULK_DELETE_CHUNK = 40;

interface BulkOnboardRowResult {
  id: number;
  company_name: string;
  status: "success" | "failed";
  score?: string;
  reasoning?: string;
  filled_fields?: string[];
  error?: string;
}

function scoreLabel(score: string | null): string {
  return score ?? "Unscored";
}

function sectionTableScope(
  section: LeadsTableSection,
): {
  source?: string;
  exclude_source?: string;
  assigned_to_user_id?: number;
  master?: boolean;
} {
  if (section === "master") return { master: true };
  if (section === "old_clients") return { source: "old_clients" };
  if (isAssignedLeadsSection(section)) {
    const userId = assignedUserIdFromSection(section);
    return userId != null ? { assigned_to_user_id: userId } : {};
  }
  return { exclude_source: "old_clients" };
}

function sectionTableParams(
  section: LeadsTableSection,
): {
  source?: string;
  exclude_source?: string;
  call_outcome?: string;
  assigned_to_user_id?: number;
  master?: boolean;
} {
  if (section === "master") return { master: true };
  if (section === "old_clients") return { source: "old_clients" };
  if (section === "interested_clients") return { call_outcome: "interested" };
  if (section === "not_interested_clients") return { call_outcome: "not_interested" };
  if (section === "not_received_call_clients") return { call_outcome: "not_received_call" };
  if (isAssignedLeadsSection(section)) {
    const userId = assignedUserIdFromSection(section);
    return userId != null ? { assigned_to_user_id: userId } : {};
  }
  return { exclude_source: "old_clients" };
}

function sectionTitle(
  section: LeadsTableSection,
  assigneeUsername?: string | null,
  isAdmin = true,
): string {
  if (section === "master") return "Master table";
  if (section === "old_clients") return isAdmin ? "Old clients" : "Clients";
  if (section === "interested_clients") return "Follow up clients";
  if (section === "not_interested_clients") return "Not interested";
  if (section === "not_received_call_clients") return "Did not receive call";
  if (isAssignedLeadsSection(section)) {
    return `Leads Sent To ${assigneeUsername || "user"}`;
  }
  return "Leads table";
}

function sectionDescription(
  section: LeadsTableSection,
  assigneeUsername?: string | null,
  isAdmin = true,
): string {
  if (section === "master") {
    return "Admin-only overview of every lead in the system — including leads sent to Asim, Usman, Sadia, or any other user. Nothing is hidden by assignment.";
  }
  if (section === "old_clients") {
    return isAdmin
      ? "Past clients from your spreadsheet only. Kept separate from Discover Leads / Leads table — companies here are never mixed into new discoveries."
      : "Your client list from imports and past relationships. Import a spreadsheet to add clients — only you can see rows assigned to you.";
  }
  if (section === "interested_clients") {
    return "Clients moved here after a call is labeled Interested. Use the calendar on each row to set when you want a follow-up reminder — you are only notified on that date.";
  }
  if (section === "not_interested_clients") {
    return "Clients moved here after a call is labeled Not interested. They no longer appear in Leads table or Old clients.";
  }
  if (section === "not_received_call_clients") {
    return "Clients moved here when a call is labeled Did not receive call. Use the calendar on each row to set when you want a reminder to try again.";
  }
  if (isAssignedLeadsSection(section)) {
    return `All leads transferred to ${assigneeUsername || "this user"}. These no longer appear in the main Leads table or Old clients.`;
  }
  return "New discoveries from Discover Leads (and leads-table imports). Does not include Old clients — companies already in Old clients are blocked from being added here.";
}

function sectionEmptyMessage(section: LeadsTableSection): string | null {
  if (section === "master") {
    return "No leads in the system yet.";
  }
  if (section === "interested_clients") {
    return "No follow up clients yet. After a call, label the client as Interested in post-call remarks, then set a follow-up date in this table.";
  }
  if (section === "not_interested_clients") {
    return "No not interested clients yet. After a call, label the client as Not interested in post-call remarks.";
  }
  if (section === "not_received_call_clients") {
    return "No clients listed yet. After a call, label the client as Did not receive call, then set a reminder date with the calendar.";
  }
  if (isAssignedLeadsSection(section)) {
    return "No leads transferred to this user yet. Assign a lead from Leads table or Old clients to move it here.";
  }
  return null;
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
    legacy_serial_no: row.legacy_serial_no,
    company_grading: row.company_grading,
    product_interest: row.product_interest,
    city: row.city,
    address: row.address,
    remarks: row.remarks,
    assigned_to: row.assigned_to,
    assigned_to_user_id: row.assigned_to_user_id,
    follow_up_at: row.follow_up_at,
    contact_designation: row.contact_designation,
    contact_secondary_mobile: row.contact_secondary_mobile,
    contact_primary_phone: row.contact_primary_phone,
    contact_secondary_phone: row.contact_secondary_phone,
    contact_secondary_email: row.contact_secondary_email,
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
    legacy_serial_no: draft.legacy_serial_no,
    company_grading: draft.company_grading,
    product_interest: draft.product_interest,
    city: draft.city,
    address: draft.address,
    remarks: draft.remarks,
    assigned_to_user_id: draft.assigned_to_user_id,
    contact_id: draft.contact_id ?? undefined,
    contact_name: draft.contact_name ?? undefined,
    contact_email: draft.contact_email ?? undefined,
    contact_phone: draft.contact_phone ?? undefined,
    contact_designation: draft.contact_designation,
    contact_secondary_mobile: draft.contact_secondary_mobile,
    contact_primary_phone: draft.contact_primary_phone,
    contact_secondary_phone: draft.contact_secondary_phone,
    contact_secondary_email: draft.contact_secondary_email,
  };
}

function FullscreenExpandIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

function FullscreenCollapseIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7" />
    </svg>
  );
}

export function LeadsTablePage({
  section,
  refreshToken = 0,
  onError,
  onSelectLead,
  onSectionCountsChange,
}: LeadsTablePageProps) {
  const { isAdmin, user } = useAuth();
  const initialTableViewRef = useRef(readStoredTableView(user?.id, section));
  const restoringSectionRef = useRef(false);
  const previousSectionRef = useRef(section);
  const [assigneeOptions, setAssigneeOptions] = useState<AssigneeOption[]>([]);
  const [filters, setFilters] = useState<LeadTableFilters | null>(null);
  const [rows, setRows] = useState<LeadTableRow[]>([]);
  const [total, setTotal] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [drafts, setDrafts] = useState<Record<number, LeadTableRow>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [originalKeys, setOriginalKeys] = useState<Record<number, string>>({});
  const [savingId, setSavingId] = useState<number | null>(null);
  const [assigningId, setAssigningId] = useState<number | null>(null);
  const [bulkAssignValue, setBulkAssignValue] = useState("");
  const [bulkAssigning, setBulkAssigning] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [saveNotice, setSaveNotice] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [allMatchingSelected, setAllMatchingSelected] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [bulkOnboarding, setBulkOnboarding] = useState(false);
  const [actionProgress, setActionProgress] = useState<BulkActionProgress | null>(null);
  const [bulkResults, setBulkResults] = useState<BulkOnboardRowResult[] | null>(null);
  const [showBulkEmail, setShowBulkEmail] = useState(false);
  const [showBulkWhatsApp, setShowBulkWhatsApp] = useState(false);
  const [bulkWhatsAppNotice, setBulkWhatsAppNotice] = useState<string | null>(null);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [bulkEmailNotice, setBulkEmailNotice] = useState<string | null>(null);
  const [deduping, setDeduping] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const showEmailNotice = useCallback((message: string) => {
    setBulkEmailNotice(message);
    window.setTimeout(() => setBulkEmailNotice(null), 8000);
  }, []);

  useEffect(() => {
    if (!isAdmin) {
      setAssigneeOptions([]);
      return;
    }
    client
      .listAssignees()
      .then((users) =>
        setAssigneeOptions(
          users.map((u) => ({
            value: String(u.id),
            label: u.full_name || u.username,
            username: u.username,
          })),
        ),
      )
      .catch(() => setAssigneeOptions([]));
  }, [isAdmin]);

  useEffect(() => {
    if (!isFullscreen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsFullscreen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isFullscreen]);

  const [score, setScore] = useState(initialTableViewRef.current.score);
  const [marketRole, setMarketRole] = useState(initialTableViewRef.current.marketRole);
  const [country, setCountry] = useState(initialTableViewRef.current.country);
  const [industry, setIndustry] = useState(initialTableViewRef.current.industry);
  const [companyGrading, setCompanyGrading] = useState(
    initialTableViewRef.current.companyGrading,
  );
  const [productInterest, setProductInterest] = useState(
    initialTableViewRef.current.productInterest,
  );
  const [city, setCity] = useState(initialTableViewRef.current.city);
  const [callRecommended, setCallRecommended] = useState(
    initialTableViewRef.current.callRecommended,
  );
  const [search, setSearch] = useState(initialTableViewRef.current.search);
  const [debouncedSearch, setDebouncedSearch] = useState(
    initialTableViewRef.current.search,
  );
  const [sortBy, setSortBy] = useState<SortField>(initialTableViewRef.current.sortBy);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(initialTableViewRef.current.sortDir);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const isAssignedSection = isAssignedLeadsSection(section);
  const assignedSectionUserId = assignedUserIdFromSection(section);
  const assigneeUsername = isAssignedSection
    ? assigneeOptions.find((o) => o.value === String(assignedSectionUserId))?.username ||
      (user?.id === assignedSectionUserId ? user.username : null) ||
      null
    : null;

  const isOldClients = section === "old_clients";
  const isMaster = section === "master";
  const canImportSpreadsheet = section === "all" || section === "old_clients";
  const canBulkAssign = isAdmin && (section === "all" || section === "old_clients" || isMaster);
  const importSource = isOldClients ? "old_clients" : "csv";
  const isCallOutcomeSection =
    section === "interested_clients" ||
    section === "not_interested_clients" ||
    section === "not_received_call_clients";
  const canScheduleFollowUp =
    section === "interested_clients" || section === "not_received_call_clients";
  const callOutcomeEmptyMessage = sectionEmptyMessage(section);

  const tableQueryParams = useMemo(
    () => ({
      score: isOldClients ? undefined : score || undefined,
      market_role: isOldClients ? undefined : marketRole || undefined,
      country: country || undefined,
      industry: isOldClients ? industry || undefined : undefined,
      company_grading: isOldClients ? companyGrading || undefined : undefined,
      product_interest: isOldClients ? productInterest || undefined : undefined,
      city: isOldClients ? city || undefined : undefined,
      call_recommended: isOldClients ? callRecommended || undefined : undefined,
      q: debouncedSearch.trim() || undefined,
      sort_by: sortBy,
      sort_dir: sortDir,
      ...sectionTableParams(section),
    }),
    [
      callRecommended,
      city,
      companyGrading,
      country,
      industry,
      isOldClients,
      marketRole,
      productInterest,
      score,
      debouncedSearch,
      section,
      sortBy,
      sortDir,
    ],
  );

  const clearSelection = useCallback(() => {
    setSelected(new Set());
    setAllMatchingSelected(false);
  }, []);

  const loadSectionCounts = useCallback(async () => {
    if (!onSectionCountsChange) return;
    try {
      const counts = await client.getLeadsTableSectionCounts();
      onSectionCountsChange({
        ...counts,
        by_assignee: counts.by_assignee ?? {},
      });
    } catch {
      /* optional */
    }
  }, [onSectionCountsChange]);

  const loadTable = useCallback(async () => {
    setLoading(true);
    try {
      const result = await client.listLeadsTable({
        ...tableQueryParams,
        page,
        page_size: TABLE_PAGE_SIZE,
      });
      setRows(result.rows);
      setTotal(result.total);
      setFilteredCount(result.filtered_count);
      setTotalPages(result.total_pages);
      setPage(result.page);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load leads table");
    } finally {
      setLoading(false);
    }
  }, [onError, page, tableQueryParams]);

  useEffect(() => {
    setPage(1);
    clearSelection();
  }, [
    clearSelection,
    section,
    score,
    marketRole,
    country,
    industry,
    companyGrading,
    productInterest,
    city,
    callRecommended,
    debouncedSearch,
    sortBy,
    sortDir,
  ]);

  useEffect(() => {
    if (previousSectionRef.current === section) return;

    previousSectionRef.current = section;
    restoringSectionRef.current = true;
    const stored = readStoredTableView(user?.id, section);
    setScore(stored.score);
    setMarketRole(stored.marketRole);
    setCountry(stored.country);
    setIndustry(stored.industry);
    setCompanyGrading(stored.companyGrading);
    setProductInterest(stored.productInterest);
    setCity(stored.city);
    setCallRecommended(stored.callRecommended);
    setSearch(stored.search);
    setDebouncedSearch(stored.search);
    setSortBy(stored.sortBy);
    setSortDir(stored.sortDir);
  }, [section, user?.id]);

  useEffect(() => {
    if (restoringSectionRef.current) {
      restoringSectionRef.current = false;
      return;
    }
    try {
      const view: StoredTableView = {
        score,
        marketRole,
        country,
        industry,
        companyGrading,
        productInterest,
        city,
        callRecommended,
        search,
        sortBy,
        sortDir,
      };
      sessionStorage.setItem(tableViewStorageKey(user?.id, section), JSON.stringify(view));
    } catch {
      /* Storage may be unavailable; the table still works with in-memory state. */
    }
  }, [
    callRecommended,
    city,
    companyGrading,
    country,
    industry,
    marketRole,
    productInterest,
    score,
    search,
    section,
    sortBy,
    sortDir,
    user?.id,
  ]);

  useEffect(() => {
    client
      .listLeadTableFilters(isOldClients ? { source: "old_clients" } : {})
      .then(setFilters)
      .catch(() => onError("Failed to load lead filters"));
    void loadSectionCounts();
  }, [isOldClients, loadSectionCounts, onError]);

  useEffect(() => {
    void loadTable();
  }, [loadTable]);

  useEffect(() => {
    if (refreshToken > 0) {
      void loadTable();
      void loadSectionCounts();
    }
  }, [loadSectionCounts, loadTable, refreshToken]);

  useEffect(() => {
    setEditMode(false);
    setDrafts({});
    setOriginalKeys({});
    setBulkResults(null);
    setSaveNotice(null);
    setShowCsvImport(false);
    setBulkAssignValue("");
    clearSelection();
  }, [clearSelection, section]);

  function enterEditMode() {
    setDrafts(Object.fromEntries(rows.map((row) => [row.id, { ...row }])));
    setOriginalKeys(Object.fromEntries(rows.map((row) => [row.id, rowDraftKey(row)])));
    setEditMode(true);
    setSaveNotice(null);
  }

  function updateDraft(rowId: number, field: keyof LeadTableRow, value: string) {
    setDrafts((prev) => {
      const current = prev[rowId];
      if (!current) return prev;
      let nextValue: string | number | null = value || null;
      if (field === "legacy_serial_no") {
        const trimmed = value.trim();
        if (!trimmed) nextValue = null;
        else {
          const parsed = Number(trimmed);
          nextValue = Number.isFinite(parsed) ? Math.trunc(parsed) : current.legacy_serial_no;
        }
      }
      return {
        ...prev,
        [rowId]: {
          ...current,
          [field]: nextValue,
        },
      };
    });
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

  function applyAssigneeMove(
    rowId: number,
    updated: LeadTableRow,
    previousAssigneeId: number | null | undefined,
  ) {
    const assignedToUserId = updated.assigned_to_user_id;
    const assigneeChanged = previousAssigneeId !== assignedToUserId;
    const leavesPoolSection =
      assigneeChanged &&
      (section === "all" || section === "old_clients") &&
      assignedToUserId != null;
    const leavesAssignedSection =
      assigneeChanged &&
      isAssignedSection &&
      (assignedToUserId == null || assignedToUserId !== assignedSectionUserId);

    if (leavesPoolSection || leavesAssignedSection) {
      setRows((prev) => prev.filter((row) => row.id !== rowId));
      setDrafts((prev) => {
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
      setOriginalKeys((prev) => {
        const next = { ...prev };
        delete next[rowId];
        return next;
      });
      setTotal((prev) => Math.max(0, prev - 1));
      setFilteredCount((prev) => Math.max(0, prev - 1));
      return true;
    }

    setRows((prev) => prev.map((row) => (row.id === rowId ? updated : row)));
    setDrafts((prev) => ({ ...prev, [rowId]: updated }));
    setOriginalKeys((prev) => ({ ...prev, [rowId]: rowDraftKey(updated) }));
    return false;
  }

  async function saveRow(rowId: number) {
    const draft = draftsRef.current[rowId];
    if (!draft) return;
    const previousAssigneeId = rows.find((r) => r.id === rowId)?.assigned_to_user_id ?? null;

    setSavingId(rowId);
    setSaveNotice(null);
    try {
      const payload = buildUpdatePayload(draft);
      if (!isAdmin) {
        delete payload.assigned_to_user_id;
      }
      const updated = await client.updateLeadTableRow(rowId, payload);
      applyAssigneeMove(rowId, updated, previousAssigneeId);
      await loadSectionCounts();
      setSaveNotice("Row saved.");
      setTimeout(() => setSaveNotice(null), 3000);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save row");
    } finally {
      setSavingId(null);
    }
  }

  async function saveAssignedTo(rowId: number, assignedToUserId: number | null) {
    if (!isAdmin) {
      onError("Only an admin can assign leads to users.");
      return;
    }
    setAssigningId(rowId);
    try {
      const previousAssigneeId = rows.find((r) => r.id === rowId)?.assigned_to_user_id ?? null;
      const updated = await client.updateLeadTableRow(rowId, {
        assigned_to_user_id: assignedToUserId,
      });
      applyAssigneeMove(rowId, updated, previousAssigneeId);
      await loadSectionCounts();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to update assignee");
    } finally {
      setAssigningId(null);
    }
  }

  async function bulkAssignSelected(rawValue: string) {
    if (!canBulkAssign || !rawValue || selected.size === 0 || bulkAssigning) {
      setBulkAssignValue("");
      return;
    }

    const assignedToUserId = rawValue === UNASSIGNED ? null : Number(rawValue);
    if (rawValue !== UNASSIGNED && !Number.isFinite(assignedToUserId)) {
      setBulkAssignValue("");
      return;
    }

    const label =
      assignedToUserId == null
        ? "Unassigned"
        : assigneeOptions.find((o) => o.value === String(assignedToUserId))?.label ||
          assigneeOptions.find((o) => o.value === String(assignedToUserId))?.username ||
          "selected user";

    const count = selected.size;
    const confirmed = window.confirm(
      assignedToUserId == null
        ? `Unassign ${count} selected lead${count === 1 ? "" : "s"}?`
        : `Assign ${count} selected lead${count === 1 ? "" : "s"} to ${label}?`,
    );
    if (!confirmed) {
      setBulkAssignValue("");
      return;
    }

    setBulkAssigning(true);
    setSaveNotice(null);
    try {
      const result = await client.bulkAssignLeadTableRows([...selected], assignedToUserId);
      const movedIds = new Set(result.assigned_ids);
      if (movedIds.size > 0) {
        setRows((prev) => prev.filter((row) => !movedIds.has(row.id)));
        setDrafts((prev) => {
          const next = { ...prev };
          for (const id of movedIds) delete next[id];
          return next;
        });
        setOriginalKeys((prev) => {
          const next = { ...prev };
          for (const id of movedIds) delete next[id];
          return next;
        });
        setTotal((prev) => Math.max(0, prev - movedIds.size));
        setFilteredCount((prev) => Math.max(0, prev - movedIds.size));
      }
      clearSelection();
      await loadSectionCounts();
      setSaveNotice(
        assignedToUserId == null
          ? `Unassigned ${result.assigned_count} lead${result.assigned_count === 1 ? "" : "s"}.`
          : `Assigned ${result.assigned_count} lead${result.assigned_count === 1 ? "" : "s"} to ${result.assigned_to}.`,
      );
      setTimeout(() => setSaveNotice(null), 4000);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to bulk assign leads");
    } finally {
      setBulkAssignValue("");
      setBulkAssigning(false);
    }
  }

  async function saveFollowUpAt(rowId: number, followUpAt: string | null) {
    try {
      const result = await client.scheduleInterestedFollowUp(rowId, followUpAt);
      setRows((prev) =>
        prev.map((row) =>
          row.id === rowId ? { ...row, follow_up_at: result.follow_up_at } : row,
        ),
      );
      setDrafts((prev) => {
        const current = prev[rowId];
        if (!current) return prev;
        return {
          ...prev,
          [rowId]: { ...current, follow_up_at: result.follow_up_at },
        };
      });
      setSaveNotice(
        followUpAt
          ? "Follow-up reminder scheduled."
          : "Follow-up reminder cleared.",
      );
      setTimeout(() => setSaveNotice(null), 3000);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to schedule follow-up");
    }
  }

  function renderAssignedToCell(row: LeadTableRow, draft: LeadTableRow) {
    if (!isAdmin) {
      return (
        <span className="text-sm text-slate-300">
          {!row.assigned_to || row.assigned_to === "unassigned"
            ? "Unassigned"
            : row.assigned_to}
        </span>
      );
    }
    return (
      <AssignedToSelect
        value={editMode ? draft.assigned_to_user_id : row.assigned_to_user_id}
        options={assigneeOptions}
        onChange={(userId) => {
          if (editMode) {
            const label =
              userId == null
                ? "unassigned"
                : assigneeOptions.find((o) => o.value === String(userId))?.label ||
                  "unassigned";
            setDrafts((prev) => ({
              ...prev,
              [row.id]: {
                ...(prev[row.id] ?? row),
                assigned_to_user_id: userId,
                assigned_to: label,
              },
            }));
            return;
          }
          void saveAssignedTo(row.id, userId);
        }}
        disabled={assigningId === row.id || savingId === row.id}
      />
    );
  }

  function toggleSelected(rowId: number) {
    setAllMatchingSelected(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function toggleSelectAllOnPage() {
    const pageIds = rows.map((row) => row.id);
    const allSelected = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
    setAllMatchingSelected(false);
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  async function selectAllMatching() {
    if (filteredCount === 0 || selectingAll) return;
    setSelectingAll(true);
    try {
      const result = await client.listLeadsTableIds(tableQueryParams);
      setSelected(new Set(result.ids));
      setAllMatchingSelected(true);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to select all matching leads");
    } finally {
      setSelectingAll(false);
    }
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
        `• Looks up company details and fills empty table fields (not just the score).\n` +
        (isOldClients
          ? `• Clients table priority: city & address first, then phone/email/designation.\n`
          : `• Leads table priority: website, email, phone, socials, country.\n`) +
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
    const startedAt = Date.now();

    const results: BulkOnboardRowResult[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const row = rows.find((r) => r.id === id);
      const companyName = row?.company_name ?? `Lead #${id}`;
      setActionProgress({
        title: "Researching & scoring leads",
        mode: "determinate",
        current: i,
        total: ids.length,
        detail: companyName,
        startedAt,
        accent: "emerald",
      });

      try {
        const result = await client.onboardLead(id);
        results.push({
          id,
          company_name: companyName,
          status: "success",
          score: result.score,
          reasoning: result.reasoning,
          filled_fields: result.enrichment?.filled_fields ?? [],
        });
      } catch (e) {
        results.push({
          id,
          company_name: companyName,
          status: "failed",
          error: e instanceof Error ? e.message : "Research & score failed",
        });
      }

      setActionProgress({
        title: "Researching & scoring leads",
        mode: "determinate",
        current: i + 1,
        total: ids.length,
        detail: companyName,
        startedAt,
        accent: "emerald",
      });

      if (i < ids.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, BULK_ONBOARD_DELAY_MS));
      }
    }

    setActionProgress(null);
    setBulkOnboarding(false);
    setBulkResults(results);
    clearSelection();
    await loadTable();
  }

  async function removeEmptyImports() {
    const confirmed = window.confirm(
      isOldClients
        ? "Remove empty old-client imports?\n\n" +
            "• Deletes old clients with no website, email, or score (failed enrichments).\n" +
            "• Use this before re-importing the same file with fresh search data.\n\n" +
            "Continue?"
        : "Remove empty CSV imports?\n\n" +
            "• Deletes CSV leads with no website, email, or score (failed scrapes).\n" +
            "• Use this before re-importing the same file with fresh scraped data.\n\n" +
            "Continue?",
    );
    if (!confirmed) return;

    setDeduping(true);
    setSaveNotice(null);
    setActionProgress({
      title: isOldClients ? "Removing empty old-client imports" : "Removing empty CSV imports",
      mode: "indeterminate",
      detail: "Finding rows with no website, email, or score…",
      startedAt: Date.now(),
      accent: "amber",
    });
    try {
      const result = await client.cleanupSparseCsvLeads(sectionTableScope(section));
      await loadTable();
      await loadSectionCounts();
      setSaveNotice(
        result.removed_count > 0
          ? `Removed ${result.removed_count} empty import${result.removed_count === 1 ? "" : "s"}`
          : "No empty imports found",
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to remove empty imports");
    } finally {
      setActionProgress(null);
      setDeduping(false);
    }
  }

  async function removeDuplicates() {
    const scopeLabel = isOldClients ? "old clients" : "leads table";
    const confirmed = window.confirm(
      `Remove duplicate ${scopeLabel} entries?\n\n` +
        "• Duplicates are matched by company name or website domain within this section only.\n" +
        "• Old clients and leads table entries are never merged together.\n" +
        "• The record with the most details (website, email, score) is kept.\n\n" +
        "Continue?",
    );
    if (!confirmed) return;

    setDeduping(true);
    setSaveNotice(null);
    setActionProgress({
      title: `Removing duplicate ${scopeLabel}`,
      mode: "indeterminate",
      detail: "Matching by company name and website domain…",
      startedAt: Date.now(),
      accent: "amber",
    });
    try {
      const result = await client.dedupeLeadsTable(sectionTableScope(section));
      await loadTable();
      await loadSectionCounts();
      setSaveNotice(
        result.removed_count > 0
          ? `Removed ${result.removed_count} duplicate lead${result.removed_count === 1 ? "" : "s"} (${result.groups.length} group${result.groups.length === 1 ? "" : "s"})`
          : "No duplicate leads found",
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to remove duplicates");
    } finally {
      setActionProgress(null);
      setDeduping(false);
    }
  }

  async function removeOldClientOverlaps() {
    if (!isAdmin || isOldClients) return;
    const confirmed = window.confirm(
      "Remove Discover / Leads table rows that match Old clients?\n\n" +
        "• Matches by company name or website domain.\n" +
        "• Old clients are never deleted — only overlapping new-discovery leads are removed.\n" +
        "• Use this if Old clients were accidentally mixed into Discover Leads.\n\n" +
        "Continue?",
    );
    if (!confirmed) return;

    setDeduping(true);
    setSaveNotice(null);
    setActionProgress({
      title: "Removing leads that match Old clients",
      mode: "indeterminate",
      detail: "Comparing Leads table against Old clients…",
      startedAt: Date.now(),
      accent: "violet",
    });
    try {
      const result = await client.removeOldClientOverlaps();
      await loadTable();
      await loadSectionCounts();
      setSaveNotice(
        result.removed_count > 0
          ? `Removed ${result.removed_count} lead${result.removed_count === 1 ? "" : "s"} that matched Old clients (${result.kept_count} discovery lead${result.kept_count === 1 ? "" : "s"} kept)`
          : "No Discover / Leads table rows matched Old clients",
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to remove old-client overlaps");
    } finally {
      setActionProgress(null);
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
    const startedAt = Date.now();
    if (rowIds.length > 1) {
      setActionProgress({
        title: "Deleting selected leads",
        mode: "determinate",
        current: 0,
        total: rowIds.length,
        detail: preview,
        startedAt,
        accent: "red",
      });
    }

    try {
      const deletedIds: number[] = [];
      if (rowIds.length === 1) {
        await client.deleteLeadTableRow(rowIds[0]);
        deletedIds.push(rowIds[0]);
      } else {
        for (let i = 0; i < rowIds.length; i += BULK_DELETE_CHUNK) {
          const chunk = rowIds.slice(i, i + BULK_DELETE_CHUNK);
          const firstName =
            rows.find((row) => row.id === chunk[0])?.company_name ?? `Lead #${chunk[0]}`;
          setActionProgress({
            title: "Deleting selected leads",
            mode: "determinate",
            current: i,
            total: rowIds.length,
            detail: firstName,
            startedAt,
            accent: "red",
          });
          const result = await client.bulkDeleteLeadTableRows(chunk);
          deletedIds.push(...(result.deleted_ids ?? chunk));
          setActionProgress({
            title: "Deleting selected leads",
            mode: "determinate",
            current: Math.min(i + chunk.length, rowIds.length),
            total: rowIds.length,
            detail: firstName,
            startedAt,
            accent: "red",
          });
        }
      }
      const removed = new Set(deletedIds.length > 0 ? deletedIds : rowIds);
      setRows((prev) => prev.filter((row) => !removed.has(row.id)));
      setTotal((prev) => Math.max(0, prev - removed.size));
      setFilteredCount((prev) => Math.max(0, prev - removed.size));
      setSelected((prev) => {
        const next = new Set(prev);
        for (const rowId of removed) next.delete(rowId);
        return next;
      });
      setDrafts((prev) => {
        const next = { ...prev };
        for (const rowId of removed) delete next[rowId];
        return next;
      });
      setOriginalKeys((prev) => {
        const next = { ...prev };
        for (const rowId of removed) delete next[rowId];
        return next;
      });
      setSaveNotice(`Deleted ${removed.size} lead${removed.size === 1 ? "" : "s"}`);
      const updatedFilters = await client.listLeadTableFilters();
      setFilters(updatedFilters);
      await loadSectionCounts();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to delete lead(s)");
    } finally {
      setActionProgress(null);
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
      const results = await Promise.all(
        dirtyIds.map(async (rowId) => {
          const draft = draftsRef.current[rowId];
          if (!draft) return null;
          const payload = buildUpdatePayload(draft);
          if (!isAdmin) {
            delete payload.assigned_to_user_id;
          }
          const updated = await client.updateLeadTableRow(rowId, payload);
          return [rowId, updated] as const;
        }),
      );
      const updatedById = new Map<number, LeadTableRow>();
      for (const entry of results) {
        if (entry) updatedById.set(entry[0], entry[1]);
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

  function sortSelectValue(): string {
    if (sortBy === "created_at") {
      return sortDir === "asc" ? "oldest" : "recent";
    }
    return sortBy;
  }

  function applySortSelect(value: string) {
    if (value === "recent") {
      setSortBy("created_at");
      setSortDir("desc");
      return;
    }
    if (value === "oldest") {
      setSortBy("created_at");
      setSortDir("asc");
      return;
    }
    const field = value as SortField;
    setSortBy(field);
    setSortDir(field === "company_name" || field === "country" ? "asc" : "desc");
  }

  function clearFilters() {
    setScore("");
    setMarketRole("");
    setCountry("");
    setIndustry("");
    setCompanyGrading("");
    setProductInterest("");
    setCity("");
    setCallRecommended("");
    setSearch("");
    setDebouncedSearch("");
    setSortBy("created_at");
    setSortDir("desc");
  }

  function sortIndicator(field: SortField): string {
    if (sortBy !== field) return "";
    return sortDir === "asc" ? " ↑" : " ↓";
  }

  const hasActiveFilters = isOldClients
    ? Boolean(
        country ||
          industry ||
          companyGrading ||
          productInterest ||
          city ||
          callRecommended ||
          search.trim(),
      )
    : Boolean(score || marketRole || country || search.trim());
  const allOnPageSelected =
    rows.length > 0 && rows.every((row) => selected.has(row.id));
  const someOnPageSelected = rows.some((row) => selected.has(row.id));
  const allMatchingAreSelected =
    allMatchingSelected && selected.size > 0 && selected.size === filteredCount;
  const showSelectAllBanner =
    filteredCount > rows.length &&
    allOnPageSelected &&
    !allMatchingAreSelected &&
    !selectingAll;
  const tableOuterClass = isFullscreen
    ? "flex flex-col flex-1 min-h-0 rounded-xl border border-slate-800 overflow-hidden"
    : "rounded-xl border border-slate-800 overflow-hidden";
  const tableBodyScrollClass = isFullscreen ? "flex-1 min-h-0 overflow-auto" : "overflow-x-auto";
  const theadStickyClass = isFullscreen ? "sticky top-0 z-[2]" : "";

  return (
    <section
      className={
        isFullscreen
          ? "fixed inset-0 z-50 flex flex-col bg-slate-950 p-3 sm:p-4 gap-3 overflow-hidden"
          : "space-y-4"
      }
    >
      <div className="flex items-start justify-between gap-4 flex-wrap shrink-0">
        <div>
          <h2 className="text-lg font-medium text-slate-100">
            {sectionTitle(section, assigneeUsername, isAdmin)}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {sectionDescription(section, assigneeUsername, isAdmin)}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            {filteredCount} matching · {total} in section · {TABLE_PAGE_SIZE} per page
            {selected.size > 0 ? (
              <span className="text-sky-400">
                {" "}
                · {selected.size} selected
                {allMatchingAreSelected ? " (all matching)" : ""}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canImportSpreadsheet && (
            <button
              type="button"
              onClick={() => setShowCsvImport(true)}
              disabled={bulkOnboarding || deletingSelected || deletingId !== null || editMode}
              className="px-3 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 border border-violet-600/50 text-sm font-medium disabled:opacity-50"
            >
              Import spreadsheet
            </button>
          )}
          <button
            type="button"
            onClick={() => void selectAllMatching()}
            disabled={
              filteredCount === 0 ||
              selectingAll ||
              allMatchingAreSelected ||
              bulkOnboarding ||
              deletingSelected ||
              deletingId !== null ||
              editMode
            }
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm font-medium disabled:opacity-50"
          >
            {selectingAll
              ? "Selecting all…"
              : allMatchingAreSelected
                ? `All ${filteredCount} selected`
                : `Select all matching (${filteredCount})`}
          </button>
          {selected.size > 0 && (
            <button
              type="button"
              onClick={clearSelection}
              disabled={bulkOnboarding || deletingSelected || deletingId !== null || editMode}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm disabled:opacity-50"
            >
              Clear selection
            </button>
          )}
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
            Send emails ({selected.size})
          </button>
          <button
            type="button"
            onClick={() => setShowBulkWhatsApp(true)}
            disabled={
              selected.size === 0 ||
              bulkOnboarding ||
              deletingSelected ||
              deletingId !== null ||
              editMode
            }
            className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 border border-emerald-600/50 text-sm font-medium disabled:opacity-50"
          >
            Send WhatsApp ({selected.size})
          </button>
          <button
            type="button"
            onClick={() => void bulkResearchAndScore()}
            disabled={
              selected.size === 0 ||
              bulkOnboarding ||
              deletingSelected ||
              deletingId !== null ||
              deduping ||
              editMode
            }
            className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 border border-emerald-600/50 text-sm font-medium disabled:opacity-50"
          >
            {bulkOnboarding
              ? actionProgress?.mode === "determinate" && actionProgress.total
                ? `Researching ${actionProgress.current ?? 0}/${actionProgress.total}…`
                : "Starting…"
              : `Research & score (${selected.size})`}
          </button>
          <button
            type="button"
            onClick={() => void deleteRows([...selected])}
            disabled={
              selected.size === 0 ||
              deletingSelected ||
              deletingId !== null ||
              bulkOnboarding ||
              deduping
            }
            className="px-3 py-1.5 rounded-lg bg-red-900/60 hover:bg-red-800 border border-red-800/60 text-sm text-red-200 disabled:opacity-50"
          >
            {deletingSelected
              ? actionProgress?.mode === "determinate" && actionProgress.total
                ? `Deleting ${actionProgress.current ?? 0}/${actionProgress.total}…`
                : "Deleting…"
              : `Delete selected (${selected.size})`}
          </button>
          {isOldClients && (
            <button
              type="button"
              onClick={() => void removeEmptyImports()}
              disabled={
                deduping ||
                rows.length === 0 ||
                loading ||
                bulkOnboarding ||
                deletingSelected
              }
              className="px-3 py-1.5 rounded-lg bg-amber-900/60 hover:bg-amber-800 border border-amber-800/60 text-sm text-amber-100 disabled:opacity-50"
            >
              {deduping && actionProgress?.title.includes("empty")
                ? "Cleaning…"
                : "Remove empty imports"}
            </button>
          )}
          <button
            type="button"
            onClick={() => void removeDuplicates()}
            disabled={
              deduping ||
              rows.length === 0 ||
              loading ||
              bulkOnboarding ||
              deletingSelected
            }
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-sm disabled:opacity-50"
          >
            {deduping && actionProgress?.title.includes("duplicate")
              ? "Removing duplicates…"
              : "Remove duplicates"}
          </button>
          {isAdmin && section === "all" && (
            <button
              type="button"
              onClick={() => void removeOldClientOverlaps()}
              disabled={
                deduping ||
                loading ||
                bulkOnboarding ||
                deletingSelected
              }
              className="px-3 py-1.5 rounded-lg bg-violet-900/60 hover:bg-violet-800 border border-violet-700/50 text-sm text-violet-100 disabled:opacity-50"
              title="Delete Leads table rows that match Old clients by name or website"
            >
              {deduping && actionProgress?.title.includes("Old clients")
                ? "Cleaning overlaps…"
                : "Remove old-client overlaps"}
            </button>
          )}
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

      <div
        className={
          isFullscreen ? "flex flex-col flex-1 min-h-0 gap-3 overflow-hidden" : "space-y-4"
        }
      >
      {editMode && (
        <p className="text-xs text-amber-300/90 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 shrink-0">
          Edit mode is on. Update fields after visiting a company website, then click Done editing to save all changes (or Save on a single row).
          Social URLs can be edited in the Socials column.
          {dirtyCount > 0 ? ` ${dirtyCount} unsaved row${dirtyCount === 1 ? "" : "s"}.` : ""}
        </p>
      )}

      {saveNotice && (
        <p className="text-xs text-emerald-300 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 shrink-0">
          {saveNotice}
        </p>
      )}

      {bulkEmailNotice && (
        <p className="text-xs text-emerald-300 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 shrink-0">
          {bulkEmailNotice}
        </p>
      )}

      {bulkWhatsAppNotice && (
        <p className="text-xs text-emerald-300 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 shrink-0">
          {bulkWhatsAppNotice}
        </p>
      )}

      {selectingAll && (
        <p className="text-xs text-slate-300 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 shrink-0">
          Selecting all {filteredCount} matching leads…
        </p>
      )}

      {showSelectAllBanner && (
        <p className="text-xs text-sky-200 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 shrink-0">
          All {rows.length} leads on this page are selected.{" "}
          <button
            type="button"
            onClick={() => void selectAllMatching()}
            className="font-medium text-sky-300 hover:text-sky-200 underline underline-offset-2"
          >
            Select all {filteredCount} matching leads
          </button>
        </p>
      )}

      {allMatchingAreSelected && filteredCount > rows.length && (
        <p className="text-xs text-sky-200 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 shrink-0">
          All {filteredCount} matching leads are selected across every page.{" "}
          <button
            type="button"
            onClick={clearSelection}
            className="font-medium text-sky-300 hover:text-sky-200 underline underline-offset-2"
          >
            Clear selection
          </button>
        </p>
      )}

      {actionProgress && <BulkActionProgressPanel progress={actionProgress} />}

      {bulkResults && bulkResults.length > 0 && (
        <div className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-3 space-y-2 shrink-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-sm text-slate-200">
              Bulk research complete —{" "}
              {bulkResults.filter((r) => r.status === "success").length} succeeded,{" "}
              {bulkResults.filter((r) => r.status === "failed").length} failed
              {(() => {
                const aaa = bulkResults.filter((r) => r.score === "AAA" || r.score === "HOT").length;
                const aa = bulkResults.filter((r) => r.score === "AA" || r.score === "WARM").length;
                const a = bulkResults.filter((r) => r.score === "A" || r.score === "COLD").length;
                if (aaa + aa + a === 0) return null;
                return (
                  <span className="text-slate-400">
                    {" "}
                    · {aaa} AAA, {aa} AA, {a} A
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
                {result.status === "success" &&
                  result.filled_fields &&
                  result.filled_fields.length > 0 && (
                    <span className="text-emerald-400/80 truncate">
                      filled {result.filled_fields.slice(0, 4).join(", ")}
                      {result.filled_fields.length > 4
                        ? ` +${result.filled_fields.length - 4}`
                        : ""}
                    </span>
                  )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3 shrink-0">
        <div
          className={`grid gap-3 sm:grid-cols-2 ${
            isOldClients ? "lg:grid-cols-4 xl:grid-cols-4" : "lg:grid-cols-4"
          }`}
        >
          {isOldClients ? (
            <>
              <label className="block text-xs text-slate-400">
                Sort by
                <select
                  value={sortSelectValue()}
                  onChange={(e) => applySortSelect(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
                >
                  <option value="recent">Recently added</option>
                  <option value="oldest">Oldest first</option>
                  <option value="company_name">Company name</option>
                  <option value="country">Country</option>
                  <option value="latest_score">Grade</option>
                </select>
              </label>

              <label className="block text-xs text-slate-400">
                Business type
                <select
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
                >
                  <option value="">All types</option>
                  {(filters?.industries ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs text-slate-400">
                Companies grading
                <select
                  value={companyGrading}
                  onChange={(e) => setCompanyGrading(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
                >
                  <option value="">All gradings</option>
                  {(filters?.company_gradings ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
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
                Call?
                <select
                  value={callRecommended}
                  onChange={(e) => setCallRecommended(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
                >
                  <option value="">Any time</option>
                  <option value="yes">Call now</option>
                  <option value="no">Not now</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>

              <label className="block text-xs text-slate-400">
                Product
                <select
                  value={productInterest}
                  onChange={(e) => setProductInterest(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
                >
                  <option value="">All products</option>
                  {(filters?.products ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs text-slate-400">
                City
                <select
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
                >
                  <option value="">All cities</option>
                  {(filters?.cities ?? []).map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-xs text-slate-400 sm:col-span-2">
                Search
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Company, contact, phone, designation, address…"
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
                />
              </label>

              {canBulkAssign && (
                <label className="block text-xs text-slate-400">
                  Assign to
                  <select
                    value={bulkAssignValue}
                    onChange={(e) => {
                      const next = e.target.value;
                      setBulkAssignValue(next);
                      void bulkAssignSelected(next);
                    }}
                    disabled={
                      selected.size === 0 ||
                      bulkAssigning ||
                      deletingSelected ||
                      editMode ||
                      assigneeOptions.length === 0
                    }
                    className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50"
                  >
                    <option value="">
                      {selected.size === 0
                        ? "Select leads first…"
                        : bulkAssigning
                          ? "Assigning…"
                          : `Assign ${selected.size} selected…`}
                    </option>
                    <option value={UNASSIGNED}>Unassigned</option>
                    {assigneeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.username || option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          ) : (
            <>
              <label className="block text-xs text-slate-400">
                Sort by
                <select
                  value={sortSelectValue()}
                  onChange={(e) => applySortSelect(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
                >
                  <option value="recent">Recently added</option>
                  <option value="oldest">Oldest first</option>
                  <option value="company_name">Company name</option>
                  <option value="country">Country</option>
                  <option value="latest_score">Grade</option>
                  <option value="market_role">Market role</option>
                </select>
              </label>

              <label className="block text-xs text-slate-400">
                Grade
                <select
                  value={score}
                  onChange={(e) => setScore(e.target.value)}
                  className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
                >
                  <option value="">All grades</option>
                  {(filters?.scores ?? ["AAA", "AA", "A", "Unscored"]).map((option) => (
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
                  {(filters?.market_roles ?? ["consumer", "producer", "hybrid", "unknown"]).map(
                    (option) => (
                      <option key={option} value={option}>
                        {option === "consumer"
                          ? "Importer"
                          : option === "producer"
                            ? "Exporter"
                            : option === "hybrid"
                              ? "Hybrid"
                              : option === "unknown"
                                ? "Unclassified"
                                : option.charAt(0).toUpperCase() + option.slice(1)}
                      </option>
                    ),
                  )}
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

              {canBulkAssign && (
                <label className="block text-xs text-slate-400">
                  Assign to
                  <select
                    value={bulkAssignValue}
                    onChange={(e) => {
                      const next = e.target.value;
                      setBulkAssignValue(next);
                      void bulkAssignSelected(next);
                    }}
                    disabled={
                      selected.size === 0 ||
                      bulkAssigning ||
                      deletingSelected ||
                      editMode ||
                      assigneeOptions.length === 0
                    }
                    className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200 disabled:opacity-50"
                  >
                    <option value="">
                      {selected.size === 0
                        ? "Select leads first…"
                        : bulkAssigning
                          ? "Assigning…"
                          : `Assign ${selected.size} selected…`}
                    </option>
                    <option value={UNASSIGNED}>Unassigned</option>
                    {assigneeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.username || option.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
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
        <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-8 text-center space-y-3">
          <p className="text-slate-400 text-sm">
            {hasActiveFilters
              ? "No leads match these filters."
              : !isAdmin
                ? isOldClients
                  ? "No clients yet. Import a CSV or Excel file to add clients to this table."
                  : callOutcomeEmptyMessage ??
                    "No clients in this section yet. After a call, clients move here from Clients."
                : isOldClients
                  ? "No old clients yet. Import a CSV or Excel file to map past clients into this table."
                  : callOutcomeEmptyMessage ?? "No leads in this section yet. Import a CSV or Excel file to get started."}
          </p>
          {canImportSpreadsheet && !hasActiveFilters && (
            <button
              type="button"
              onClick={() => setShowCsvImport(true)}
              className="px-3 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 border border-violet-600/50 text-sm font-medium"
            >
              Import spreadsheet
            </button>
          )}
        </div>
      ) : (
        <div className={tableOuterClass}>
          <div className="flex justify-end px-2 py-1 border-b border-slate-800/80 bg-slate-950 shrink-0">
            <button
              type="button"
              onClick={() => setIsFullscreen((prev) => !prev)}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
                isFullscreen
                  ? "text-amber-400 hover:text-amber-300 hover:bg-amber-500/10"
                  : "text-slate-500 hover:text-slate-200 hover:bg-slate-800"
              }`}
              title={isFullscreen ? "Exit full screen (Esc)" : "Expand table"}
              aria-label={isFullscreen ? "Exit full screen" : "Expand table to full screen"}
            >
              {isFullscreen ? <FullscreenCollapseIcon /> : <FullscreenExpandIcon />}
            </button>
          </div>
          <div className={tableBodyScrollClass}>
          {isOldClients ? (
            <table className="w-full min-w-[2400px] text-sm border-collapse">
              <thead>
                <tr className={`text-slate-500 border-b border-slate-800 bg-slate-950 ${theadStickyClass}`}>
                  <th
                    className={`${TH} w-12 sticky left-0 bg-slate-950 z-[1] ${
                      isFullscreen ? "top-0 z-[3]" : ""
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={allOnPageSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = someOnPageSelected && !allOnPageSelected;
                      }}
                      onChange={toggleSelectAllOnPage}
                      aria-label="Select all leads on this page"
                      className="rounded border-slate-600 bg-slate-950"
                    />
                  </th>
                  <th className={`${TH} min-w-[72px]`}>S. No</th>
                  <th className={`${TH} min-w-[180px]`}>
                    <button type="button" onClick={() => toggleSort("company_name")} className="hover:text-slate-300">
                      Company Name{sortIndicator("company_name")}
                    </button>
                  </th>
                  <th className={`${TH} min-w-[120px]`}>
                    <button type="button" onClick={() => toggleSort("created_at")} className="hover:text-slate-300">
                      Added{sortIndicator("created_at")}
                    </button>
                  </th>
                  <th className={`${TH} min-w-[140px]`}>Business Type</th>
                  <th className={`${TH} min-w-[140px]`}>Companies Grading</th>
                  <th className={`${TH} min-w-[130px]`}>Designation</th>
                  <th className={`${TH} min-w-[150px]`}>Contact Person</th>
                  <th className={`${TH} min-w-[170px]`}>Primary Mobile No.</th>
                  <th className={`${TH} min-w-[170px]`}>Secondary Mobile No.</th>
                  <th className={`${TH} min-w-[160px]`}>Primary Phone No.</th>
                  <th className={`${TH} min-w-[160px]`}>Secondary Phone No.</th>
                  <th className={`${TH} min-w-[200px]`}>Primary Email</th>
                  <th className={`${TH} min-w-[180px]`}>Secondary Email</th>
                  <th className={`${TH} min-w-[130px]`}>Country</th>
                  <th className={`${TH} min-w-[130px]`}>Call?</th>
                  <th className={`${TH} min-w-[140px]`}>Product</th>
                  <th className={`${TH} min-w-[120px]`}>City</th>
                  <th className={`${TH} min-w-[200px]`}>Address</th>
                  <th className={`${TH} min-w-[180px]`}>Remarks</th>
                  <th className={`${TH} min-w-[150px]`}>Assigned To</th>
                  <th className={`${TH} min-w-[90px]`}>Grade</th>
                  <th className={`${TH} min-w-[160px]`}>Website</th>
                  <th className={`${TH} min-w-[120px]`}>Socials</th>
                  {editMode && <th className={`${TH} min-w-[120px]`}>Edit</th>}
                  <th className={`${TH} min-w-[100px]`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const draft = drafts[row.id] ?? row;
                  const dirty = editMode && isRowDirty(row.id);
                  const cell = (
                    field: keyof LeadTableRow,
                    display: string,
                    opts?: { type?: string; className?: string },
                  ) =>
                    editMode ? (
                      <input
                        type={opts?.type ?? "text"}
                        value={
                          field === "legacy_serial_no"
                            ? draft.legacy_serial_no != null
                              ? String(draft.legacy_serial_no)
                              : ""
                            : String((draft[field] as string | null | undefined) ?? "")
                        }
                        onChange={(e) => updateDraft(row.id, field, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        className={`${EDIT_INPUT} ${opts?.className ?? ""}`}
                      />
                    ) : (
                      <span className={`block truncate ${opts?.className ?? ""}`}>{display || "—"}</span>
                    );

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
                      <td
                        className={`${TD} sticky left-0 bg-slate-900 z-[1]`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          onChange={() => toggleSelected(row.id)}
                          aria-label={`Select ${row.company_name}`}
                          className="rounded border-slate-600 bg-slate-950"
                        />
                      </td>
                      <td className={TD_MUTED}>
                        {cell("legacy_serial_no", row.legacy_serial_no != null ? String(row.legacy_serial_no) : "")}
                      </td>
                      <td className={TD_PRIMARY}>
                        {cell("company_name", row.company_name)}
                      </td>
                      <td className={TD_MUTED} title={row.created_at || undefined}>
                        {formatAddedAt(row.created_at)}
                      </td>
                      <td className={TD_MUTED}>{cell("industry", row.industry ?? "")}</td>
                      <td className={TD_MUTED}>
                        {cell("company_grading", row.company_grading ?? "")}
                      </td>
                      <td className={TD_MUTED}>
                        {cell("contact_designation", row.contact_designation ?? "")}
                      </td>
                      <td className={TD_MUTED}>
                        {cell("contact_name", row.contact_name ?? "")}
                      </td>
                      <td className={TD_MUTED}>
                        {editMode ? (
                          cell("contact_phone", row.contact_phone ?? "")
                        ) : row.contact_phone ? (
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="truncate">{row.contact_phone}</span>
                            <CallLeadButton
                              leadId={row.id}
                              phone={row.contact_phone}
                              onError={onError}
                              compact
                            />
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={TD_MUTED}>
                        {cell("contact_secondary_mobile", row.contact_secondary_mobile ?? "")}
                      </td>
                      <td className={TD_MUTED}>
                        {editMode ? (
                          cell("contact_primary_phone", row.contact_primary_phone ?? "")
                        ) : row.contact_primary_phone ? (
                          <span className="flex items-center gap-2 min-w-0">
                            <span className="truncate">{row.contact_primary_phone}</span>
                            <CallLeadButton
                              leadId={row.id}
                              phone={row.contact_primary_phone}
                              onError={onError}
                              compact
                            />
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={TD_MUTED}>
                        {cell("contact_secondary_phone", row.contact_secondary_phone ?? "")}
                      </td>
                      <td
                        className={TD_MUTED}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {editMode ? (
                          cell("contact_email", row.contact_email ?? "", { type: "email" })
                        ) : row.contact_email ? (
                          <EmailComposeButton
                            row={row}
                            email={row.contact_email}
                            onError={onError}
                            onDraftCreated={showEmailNotice}
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={TD_MUTED}>
                        {editMode ? (
                          cell("contact_secondary_email", row.contact_secondary_email ?? "", {
                            type: "email",
                          })
                        ) : row.contact_secondary_email ? (
                          <span className="truncate block text-slate-300">
                            {row.contact_secondary_email}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={TD_MUTED}>
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
                      <td className={TD}>
                        <CallRecommendationBadge
                          recommended={row.call_recommended}
                          localTime={row.call_local_time}
                          reason={row.call_reason}
                        />
                      </td>
                      <td className={TD_MUTED}>
                        {cell("product_interest", row.product_interest ?? "")}
                      </td>
                      <td className={TD_MUTED}>{cell("city", row.city ?? "")}</td>
                      <td className={TD_MUTED}>{cell("address", row.address ?? "")}</td>
                      <td className={TD_MUTED}>{cell("remarks", row.remarks ?? "")}</td>
                      <td className={TD_MUTED} onClick={(e) => e.stopPropagation()}>
                        {renderAssignedToCell(row, draft)}
                      </td>
                      <td className={TD}>
                        <ScoreBadge score={scoreLabel(row.company_grading || row.latest_score)} />
                      </td>
                      <td className={TD_MUTED}>
                        {editMode ? (
                          cell("website_url", row.website_url ?? "")
                        ) : row.website_url ? (
                          <a
                            href={row.website_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-400 hover:text-emerald-300 truncate block"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row.website_url.replace(/^https?:\/\//i, "")}
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className={TD} onClick={(e) => e.stopPropagation()}>
                        {editMode ? (
                          <div className="space-y-1">
                            <input
                              value={draft.linkedin_company_url ?? ""}
                              onChange={(e) => updateDraft(row.id, "linkedin_company_url", e.target.value)}
                              placeholder="LinkedIn URL"
                              className={EDIT_INPUT}
                            />
                            <input
                              value={draft.facebook_company_url ?? ""}
                              onChange={(e) => updateDraft(row.id, "facebook_company_url", e.target.value)}
                              placeholder="Facebook URL"
                              className={EDIT_INPUT}
                            />
                            <input
                              value={draft.instagram_company_url ?? ""}
                              onChange={(e) => updateDraft(row.id, "instagram_company_url", e.target.value)}
                              placeholder="Instagram URL"
                              className={EDIT_INPUT}
                            />
                          </div>
                        ) : (
                          <SocialLinksCell
                            companyName={row.company_name}
                            linkedinUrl={row.linkedin_company_url}
                            facebookUrl={row.facebook_company_url}
                            instagramUrl={row.instagram_company_url}
                          />
                        )}
                      </td>
                      {editMode && (
                        <td className={`${TD} whitespace-nowrap`}>
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
                      <td className={`${TD} whitespace-nowrap`}>
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
          ) : (
          <table
            className={`w-full text-sm border-collapse ${
              canScheduleFollowUp
                ? "min-w-[1900px]"
                : isCallOutcomeSection
                  ? "min-w-[1720px]"
                  : "min-w-[1500px]"
            }`}
          >
            <thead>
              <tr className={`text-slate-500 border-b border-slate-800 bg-slate-950 ${theadStickyClass}`}>
                <th className={`${TH} w-12`}>
                  <input
                    type="checkbox"
                    checked={allOnPageSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someOnPageSelected && !allOnPageSelected;
                    }}
                    onChange={toggleSelectAllOnPage}
                    aria-label="Select all leads on this page"
                    className="rounded border-slate-600 bg-slate-950"
                  />
                </th>
                <th className={`${TH} min-w-[200px]`}>
                  <button type="button" onClick={() => toggleSort("company_name")} className="hover:text-slate-300">
                    Company{sortIndicator("company_name")}
                  </button>
                </th>
                <th className={`${TH} min-w-[120px]`}>
                  <button type="button" onClick={() => toggleSort("created_at")} className="hover:text-slate-300">
                    Added{sortIndicator("created_at")}
                  </button>
                </th>
                <th className={`${TH} min-w-[88px]`}>
                  <button type="button" onClick={() => toggleSort("latest_score")} className="hover:text-slate-300">
                    Grade{sortIndicator("latest_score")}
                  </button>
                </th>
                <th className={`${TH} min-w-[140px]`}>
                  <button type="button" onClick={() => toggleSort("market_role")} className="hover:text-slate-300">
                    Role{sortIndicator("market_role")}
                  </button>
                </th>
                <th className={`${TH} min-w-[130px]`}>
                  <button type="button" onClick={() => toggleSort("country")} className="hover:text-slate-300">
                    Country{sortIndicator("country")}
                  </button>
                </th>
                <th className={`${TH} min-w-[130px]`}>Call?</th>
                <th className={`${TH} min-w-[130px]`}>Contact</th>
                <th className={`${TH} min-w-[200px]`}>Email</th>
                <th className={`${TH} min-w-[160px]`}>Phone</th>
                <th className={`${TH} min-w-[150px]`}>Assigned To</th>
                {isCallOutcomeSection && (
                  <th className={`${TH} min-w-[220px]`}>Call remarks</th>
                )}
                {canScheduleFollowUp && (
                  <th className={`${TH} min-w-[190px]`}>Follow-up reminder</th>
                )}
                <th className={`${TH} min-w-[160px]`}>Website</th>
                <th className={`${TH} min-w-[120px]`}>Socials</th>
                {editMode && <th className={`${TH} min-w-[120px]`}>Edit</th>}
                <th className={`${TH} min-w-[100px]`}>Actions</th>
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
                    <td className={TD} onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(row.id)}
                        onChange={() => toggleSelected(row.id)}
                        aria-label={`Select ${row.company_name}`}
                        className="rounded border-slate-600 bg-slate-950"
                      />
                    </td>
                    <td className={TD_PRIMARY}>
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
                    <td className={TD_MUTED} title={row.created_at || undefined}>
                      {formatAddedAt(row.created_at)}
                    </td>
                    <td className={TD}>
                      {editMode ? (
                        <div onClick={(e) => e.stopPropagation()}>
                          <select
                            value={draft.company_grading ?? row.company_grading ?? row.latest_score ?? ""}
                            onChange={(e) =>
                              updateDraft(row.id, "company_grading", e.target.value)
                            }
                            className={EDIT_INPUT}
                          >
                            <option value="">Ungraded</option>
                            <option value="AAA">AAA</option>
                            <option value="AA">AA</option>
                            <option value="A">A</option>
                          </select>
                        </div>
                      ) : (
                        <ScoreBadge
                          score={scoreLabel(row.company_grading || row.latest_score)}
                        />
                      )}
                    </td>
                    <td className={TD}>
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
                    <td className={TD_MUTED}>
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
                    <td className={TD}>
                      <CallRecommendationBadge
                        recommended={row.call_recommended}
                        localTime={row.call_local_time}
                        reason={row.call_reason}
                      />
                    </td>
                    <td className={TD_MUTED}>
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
                    <td
                      className={TD_MUTED}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {editMode ? (
                        <input
                          type="email"
                          value={draft.contact_email ?? ""}
                          onChange={(e) => updateDraft(row.id, "contact_email", e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className={EDIT_INPUT}
                        />
                      ) : row.contact_email ? (
                        <EmailComposeButton
                          row={row}
                          email={row.contact_email}
                          onError={onError}
                          onDraftCreated={showEmailNotice}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={TD_MUTED}>
                      {editMode ? (
                        <input
                          value={draft.contact_phone ?? ""}
                          onChange={(e) => updateDraft(row.id, "contact_phone", e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className={EDIT_INPUT}
                        />
                      ) : row.contact_phone ? (
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="truncate">{row.contact_phone}</span>
                          <CallLeadButton
                            leadId={row.id}
                            phone={row.contact_phone}
                            onError={onError}
                            compact
                          />
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={TD_MUTED} onClick={(e) => e.stopPropagation()}>
                      {renderAssignedToCell(row, draft)}
                    </td>
                    {isCallOutcomeSection && (
                      <td className={TD_MUTED}>
                        {row.call_remarks ? (
                          <span
                            className="block whitespace-pre-wrap text-slate-300 text-xs leading-relaxed max-w-[280px]"
                            title={row.call_remarks}
                          >
                            {row.call_remarks}
                          </span>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    )}
                    {canScheduleFollowUp && (
                      <td className={TD_MUTED} onClick={(e) => e.stopPropagation()}>
                        <FollowUpScheduleControl
                          value={row.follow_up_at}
                          onChange={(next) => saveFollowUpAt(row.id, next)}
                        />
                      </td>
                    )}
                    <td className={TD_MUTED}>
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
                    <td className={TD}>
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
                      <td className={`${TD} whitespace-nowrap`}>
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
                    <td className={`${TD} whitespace-nowrap`}>
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
          )}
          </div>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <Pagination
          page={page}
          totalPages={totalPages}
          totalItems={filteredCount}
          pageSize={TABLE_PAGE_SIZE}
          onPageChange={setPage}
          disabled={loading || bulkOnboarding || deletingSelected || editMode}
        />
      )}
      </div>

      {showCsvImport && canImportSpreadsheet && (
        <LeadsTableCsvImport
          onClose={() => setShowCsvImport(false)}
          onImported={() => {
            // Show newest imported rows on the section that was just targeted.
            clearFilters();
            setPage(1);
            setSortBy("created_at");
            setSortDir("desc");
            void loadTable();
            void loadSectionCounts();
            setSaveNotice("Import finished — table refreshed to show the newest rows.");
            window.setTimeout(() => setSaveNotice(null), 6000);
          }}
          onError={onError}
          importSource={importSource}
          tableLabel={
            isOldClients ? (isAdmin ? "Old clients" : "Clients") : undefined
          }
          title={
            isOldClients
              ? isAdmin
                ? "Import old clients"
                : "Import clients"
              : "Import leads"
          }
          description={
            isOldClients
              ? isAdmin
                ? "Upload CSV or Excel (.xlsx). Columns are mapped to the Old clients table. Import only saves rows as-is — research and score later from the table."
                : "Upload CSV or Excel (.xlsx). Columns are mapped to your Clients table. Import only saves rows as-is — research and score later from the table."
              : "Upload CSV or Excel (.xlsx). Rows are saved into your leads table as-is — research and score them from the table when ready."
          }
        />
      )}

      {showBulkEmail && (
        <BulkEmailModal
          buyerIds={[...selected]}
          sampleBuyerId={[...selected][0] ?? null}
          sampleCompanyName={rows.find((r) => selected.has(r.id))?.company_name}
          onClose={() => setShowBulkEmail(false)}
          onError={onError}
          onCreated={(result) => {
            setBulkEmailNotice(
              `Sent ${result.sent_count ?? 0} email(s). ` +
                ((result.failed_count ?? 0) > 0
                  ? `${result.failed_count} failed. `
                  : "") +
                (result.skipped_count > 0
                  ? `${result.skipped_count} skipped (no email on file). `
                  : "") +
                "Open Email Activity for live notifications.",
            );
            clearSelection();
          }}
        />
      )}

      {showBulkWhatsApp && (
        <BulkWhatsAppModal
          buyerIds={[...selected]}
          onClose={() => setShowBulkWhatsApp(false)}
          onError={onError}
          onCreated={(result) => {
            setBulkWhatsAppNotice(
              `Sent ${result.sent_count ?? 0} WhatsApp message(s). ` +
                ((result.failed_count ?? 0) > 0 ? `${result.failed_count} failed. ` : "") +
                (result.skipped_count > 0
                  ? `${result.skipped_count} skipped (no phone or opt-in). `
                  : "") +
                "Check Email Activity for delivery updates.",
            );
            clearSelection();
          }}
        />
      )}
    </section>
  );
}
