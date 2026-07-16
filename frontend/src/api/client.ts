/**
 * Single API client for the FastAPI backend.
 * All pages/hooks must call through here — never scatter fetch() elsewhere.
 */

import { clearSession, getStoredToken } from "../auth/session";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

/** External quotation agent (separate app). */
export const QUOTATION_AGENT_URL =
  import.meta.env.VITE_QUOTATION_AGENT_URL ??
  "https://bank-recon-demo.vercel.app/cnf";

function authHeaders(extra?: HeadersInit): HeadersInit {
  const token = getStoredToken();
  return {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...extra,
  };
}

function parseErrorDetail(text: string, fallback: string): string {
  if (!text) return fallback;
  try {
    const parsed = JSON.parse(text) as { detail?: unknown };
    if (typeof parsed.detail === "string") return parsed.detail;
    if (Array.isArray(parsed.detail)) {
      return parsed.detail
        .map((item) => (typeof item === "object" && item && "msg" in item ? String((item as { msg: unknown }).msg) : String(item)))
        .join("; ");
    }
  } catch {
    /* plain text */
  }
  return text;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(authHeaders({ "Content-Type": "application/json" }));
  if (options?.headers) {
    const extra = new Headers(options.headers);
    extra.forEach((value, key) => headers.set(key, value));
  }

  const method = (options?.method || "GET").toUpperCase();
  const canRetry = method === "GET" || method === "HEAD";
  let lastNetworkError: Error | null = null;

  for (let attempt = 0; attempt < (canRetry ? 2 : 1); attempt += 1) {
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
      });
      if (res.status === 401 && path !== "/auth/login") {
        clearSession();
        if (!window.location.hash.includes("login")) {
          window.dispatchEvent(new Event("kafi:auth-expired"));
        }
      }
      if (!res.ok) {
        const text = await res.text();
        throw new Error(parseErrorDetail(text, res.statusText));
      }
      if (res.status === 204) {
        return undefined as T;
      }
      const text = await res.text();
      if (!text) {
        return undefined as T;
      }
      return JSON.parse(text) as T;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const isNetwork =
        err instanceof TypeError ||
        /failed to fetch|networkerror|load failed|fetch failed/i.test(message);
      if (isNetwork && canRetry && attempt === 0) {
        lastNetworkError = err instanceof Error ? err : new Error(message);
        await new Promise((resolve) => setTimeout(resolve, 400));
        continue;
      }
      if (isNetwork) {
        throw new Error(
          "Cannot reach the API right now. Check your connection, then refresh. If this keeps happening, Railway may be restarting.",
        );
      }
      throw err;
    }
  }

  throw lastNetworkError ?? new Error("Cannot reach the API right now.");
}

export interface InboxMailboxStatus {
  provider: "gmail" | "outlook" | string;
  email: string | null;
  configured: boolean;
}

export interface InboxStatus {
  configured: boolean;
  email: string | null;
  emails: string[];
  mailboxes: InboxMailboxStatus[];
  unread_count: number;
  showing_since: string | null;
}

export interface InboxMessageSummary {
  uid: string;
  folder?: string;
  provider?: string | null;
  subject: string;
  from_email: string | null;
  from_name: string | null;
  to?: string[];
  cc?: string[];
  date: string | null;
  preview: string;
  unread: boolean;
  has_attachments: boolean;
  message_id: string | null;
  in_reply_to?: string | null;
  references?: string | null;
  direction?: "inbound" | "outbound" | string;
}

export interface InboxAttachment {
  filename: string | null;
  size: number | null;
  content_type: string | null;
}

export interface InboxMessageDetail extends InboxMessageSummary {
  to: string[];
  cc: string[];
  body_text: string | null;
  body_html: string | null;
  attachments: InboxAttachment[];
}

export interface InboxThreadSummary {
  thread_id: string;
  subject: string;
  participants: string[];
  message_count: number;
  unread_count: number;
  latest_date: string | null;
  latest_preview: string;
  latest_from_email: string | null;
  latest_from_name: string | null;
  has_attachments: boolean;
  provider?: string | null;
}

export interface InboxThreadDetail extends InboxThreadSummary {
  messages: InboxMessageDetail[];
}

export interface InboxReplyResponse {
  status: string;
  message: string;
  to: string | null;
  subject: string | null;
}

export interface AppUser {
  id: number;
  username: string;
  full_name: string;
  role: "admin" | "user" | string;
  is_active: boolean;
}

export interface KpiCounts {
  calls_logged: number;
  outcomes_interested: number;
  outcomes_not_interested: number;
  outcomes_not_received_call: number;
  call_remarks: number;
  leads_imported: number;
  table_edits: number;
  email_templates_created: number;
  bulk_emails_sent: number;
  inbox_replies: number;
  brand_assistant_sessions: number;
}

export interface KpiActivityItem {
  id: number;
  user_id: number;
  username: string | null;
  full_name: string | null;
  activity_type: string;
  title: string;
  summary: string;
  quantity: number;
  entity_type: string | null;
  entity_id: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface KpiPerUserSummary {
  user: {
    id: number;
    username: string;
    full_name: string;
    role: string;
  } | null;
  counts: KpiCounts;
  activity_count: number;
}

export type KpiPeriod = "day" | "week" | "month";

export interface DailyKpiReport {
  date: string;
  period: KpiPeriod | string;
  date_start?: string | null;
  date_end?: string | null;
  timezone: string;
  scope: "user" | "team" | string;
  user: {
    id: number;
    username: string;
    full_name: string;
    role: string;
  } | null;
  counts: KpiCounts;
  per_user: KpiPerUserSummary[];
  activities: KpiActivityItem[];
  activity_count: number;
}

export interface KpiSummaryResponse {
  summary: string;
  source: string;
  subject: string;
  report: DailyKpiReport;
}

export interface LoginResponse {
  token: string;
  user: AppUser;
}

export interface Lead {
  id: number;
  company_name: string;
  website_url: string | null;
  country: string | null;
  industry: string | null;
  source: string | null;
  market_role?: string;
  market_role_reasoning?: string | null;
  market_role_confidence?: number | null;
  producer_tier?: string | null;
  producer_conversion_pct?: number | null;
  producer_tier_reasoning?: string | null;
  created_at: string;
  latest_score?: string | null;
  score_reasoning?: string | null;
}

export interface LeadListResponse {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  rows: Lead[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  reply: string;
  provider: string;
  model: string;
}

export interface ChatbotStatus {
  gemini: boolean;
  openai: boolean;
  anthropic: boolean;
}

export interface InterestedFollowUp {
  id: string;
  buyer_id: number;
  company_name: string;
  contact_name: string | null;
  interested_at: string;
  weeks_since_placement: number;
  days_since_placement?: number;
  due_at: string;
  call_outcome?: string | null;
  table_section?: string | null;
}

export interface BuyerProfile {
  buyer_id: number;
  company_name: string;
  website_url: string | null;
  country: string | null;
  industry: string | null;
  website_summary: string | null;
  relationship_context: string | null;
  signals: string[];
  matched_categories: string[];
  matched_products: Array<{
    name: string;
    category: string;
    type_key?: string;
    matched_keyword?: string;
  }>;
  product_fit_score?: number;
  market_role?: string;
  market_role_reasoning?: string | null;
  market_role_confidence?: number | null;
  producer_tier?: string | null;
  producer_conversion_pct?: number | null;
  producer_tier_reasoning?: string | null;
  researched_at?: string | null;
}

export interface LeadScore {
  id: number;
  buyer_id: number;
  score: string;
  reasoning: string;
  scored_at: string;
}

export interface CrossSellRecommendation {
  category: string;
  product_name: string;
  rationale: string;
}

export interface EmailAttachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
}

export interface DraftInteraction {
  id: number;
  contact_id: number;
  channel: string;
  subject: string | null;
  content: string;
  status: string;
  created_at: string;
  company_name?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  attachments?: EmailAttachment[];
}

export interface CallConfig {
  configured: boolean;
  webhooks_ready: boolean;
  browser_ready: boolean;
  caller_id_masked?: string | null;
  setup_message?: string | null;
  missing_env?: string[];
}

export interface VoiceToken {
  token: string;
  identity: string;
}

export interface CallInitiateResult extends DraftInteraction {
  call_sid?: string | null;
  call_status?: string | null;
  lead_phone?: string | null;
  message?: string | null;
}

export interface CallHistoryItem {
  id: number;
  contact_id: number;
  buyer_id?: number | null;
  company_name?: string | null;
  contact_name?: string | null;
  contact_phone?: string | null;
  channel: string;
  direction: string;
  subject?: string | null;
  content?: string | null;
  status: string;
  created_at: string;
  call_sid?: string | null;
  call_status?: string | null;
  call_duration_seconds?: number | null;
  lead_phone?: string | null;
  notes?: string | null;
  call_outcome?: string | null;
  recording_available?: boolean;
  recording_sid?: string | null;
  recording_duration_seconds?: number | null;
  recording_url?: string | null;
  download_url?: string | null;
  transcript?: string | null;
  transcript_status?: string | null;
  transcript_error?: string | null;
}

export interface CallHistoryListResponse {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  since_days?: number | null;
  rows: CallHistoryItem[];
}

export interface ApproveDraftResult {
  interaction: DraftInteraction;
  sent: boolean;
  send_status: string | null;
  send_message: string | null;
}

export interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  body: string;
  attachments?: EmailAttachment[];
  created_at: string;
  updated_at: string;
}

export interface EmailTemplatePreview {
  subject: string;
  body: string;
  company_name: string;
  contact_email: string;
}

export interface BulkEmailDraftResponse {
  created_count: number;
  skipped_count: number;
  sent_count?: number;
  failed_count?: number;
  created: Array<{
    buyer_id: number;
    company_name: string;
    interaction_id: number;
    contact_id: number;
    sent?: boolean;
    send_status?: string | null;
    send_message?: string | null;
  }>;
  skipped: Array<{
    buyer_id: number;
    company_name?: string | null;
    reason: string;
  }>;
}

export interface ManualEmailSendResult {
  interaction: DraftInteraction;
  sent: boolean;
  send_status: string | null;
  send_message: string | null;
}

export interface EmailActivityEvent {
  id: number;
  event_type: string;
  event_label: string;
  severity: string;
  title: string;
  message: string;
  buyer_id: number | null;
  contact_id: number | null;
  interaction_id: number | null;
  details: Record<string, unknown>;
  read_at: string | null;
  created_at: string | null;
}

export interface EmailActivityListResponse {
  total: number;
  unread_count: number;
  page: number;
  page_size: number;
  total_pages: number;
  rows: EmailActivityEvent[];
}

export interface EmailActivityCatalogItem {
  event_type: string;
  label: string;
  description: string;
  severity: string;
}

export interface BulkApproveResponse {
  processed: number;
  sent_count: number;
  failed_count: number;
  results: Array<{
    interaction_id: number;
    status: string;
    sent: boolean;
    send_status?: string | null;
    send_message?: string | null;
  }>;
}

export interface BulkEmailSettings {
  batch_size: number;
  message_delay_seconds: number;
  batch_pause_seconds: number;
  max_per_request: number;
  gmail_daily_limit_hint: number;
  recommendation: string;
}

export interface ConsentSummary {
  total: number;
  unknown: number;
  granted: number;
  denied: number;
  with_birthday: number;
}

export interface ComplianceContact {
  id: number;
  buyer_id: number;
  company_name: string;
  country: string | null;
  full_name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  consent_status: string;
  preferred_language: string | null;
  birthday_outreach_ok: boolean;
}

export interface ProductType {
  type_key: string;
  name: string;
  category: string;
}

export interface OnboardResult {
  buyer_id: number;
  score: string;
  reasoning: string;
  next_actions: string[];
  enrichment?: {
    buyer_id?: number;
    filled_fields?: string[];
    website_url?: string | null;
    source_detail?: string | null;
    error?: string;
  } | null;
}

export interface LeadCreate {
  company_name: string;
  website_url?: string;
  country?: string;
  industry?: string;
  source?: string;
}

export interface Contact {
  id: number;
  buyer_id: number;
  full_name: string;
  designation: string | null;
  email: string | null;
  phone: string | null;
  preferred_language: string | null;
  consent_status: string;
}

export interface ContactCreate {
  buyer_id: number;
  full_name: string;
  designation?: string;
  email?: string;
  phone?: string;
  preferred_language?: string;
  consent_status?: string;
}

export interface ContactUpdate {
  full_name?: string;
  designation?: string;
  email?: string;
  phone?: string;
  preferred_language?: string;
  consent_status?: string;
}

export interface DiscoveryCandidate {
  candidate_id: string;
  company_name: string;
  website_url: string | null;
  contact_name: string | null;
  email: string;
  phone: string;
  facebook_url: string;
  instagram_url: string;
  linkedin_url: string;
  country: string | null;
  industry: string | null;
  legacy_serial_no?: number | null;
  company_grading?: string | null;
  designation?: string | null;
  secondary_mobile?: string | null;
  primary_phone?: string | null;
  secondary_phone?: string | null;
  secondary_email?: string | null;
  product_interest?: string | null;
  city?: string | null;
  address?: string | null;
  remarks?: string | null;
  source: string;
  source_detail: string;
  match_reason: string;
  already_exists: boolean;
  is_valid_business?: boolean;
  invalid_reason?: string | null;
}

export interface DiscoveryRegion {
  code: string;
  label: string;
  group: string;
  gl_code: string;
}

export interface DiscoveryRegionsResponse {
  max_regions: number;
  regions: DiscoveryRegion[];
}

export interface DiscoverLeadsRequest {
  seed_lead_id?: number;
  region_codes?: string[];
  industry?: string;
  industries?: string[];
  categories?: string[];
  limit?: number;
  use_web_search?: boolean;
  use_website_links?: boolean;
  skip_enrichment?: boolean;
}

export const MAX_DISCOVERY_BATCH = 15;

export interface DiscoverLeadsResponse {
  candidates: DiscoveryCandidate[];
  sources_used: string[];
  messages: string[];
  search_query: string | null;
  import_parser?: string | null;
}

export interface DiscoverImportRequest {
  candidates: Array<{
    company_name: string;
    website_url?: string;
    contact_name?: string;
    email?: string;
    phone?: string;
    facebook_url?: string;
    instagram_url?: string;
    linkedin_url?: string;
    country?: string;
    industry?: string;
    legacy_serial_no?: number | null;
    company_grading?: string;
    designation?: string;
    secondary_mobile?: string;
    primary_phone?: string;
    secondary_phone?: string;
    secondary_email?: string;
    product_interest?: string;
    city?: string;
    address?: string;
    remarks?: string;
    source?: string;
  }>;
  auto_onboard?: boolean;
  replace_duplicates?: boolean;
  skip_enrichment?: boolean;
}

export interface DiscoverImportResponse {
  created_count: number;
  skipped_count: number;
  replaced_count?: number;
  created: Lead[];
  skipped: Array<{ company_name: string; reason: string }>;
  replaced?: Array<{ company_name: string; replaced_id: number; reason: string }>;
  onboard_results: Array<Record<string, unknown>>;
}

export interface LeadTableDedupeResponse {
  removed_count: number;
  kept_count: number;
  groups: Array<{
    company_name: string;
    kept_id: number;
    removed_ids: number[];
    removed_names: string[];
  }>;
}

export interface LeadTableCleanupResponse {
  removed_count: number;
  removed: Array<{ id: number; company_name: string }>;
}

export interface LeadTableRow {
  id: number;
  company_name: string;
  country: string | null;
  industry: string | null;
  website_url: string | null;
  linkedin_company_url: string | null;
  facebook_company_url: string | null;
  instagram_company_url: string | null;
  source: string | null;
  legacy_serial_no: number | null;
  company_grading: string | null;
  product_interest: string | null;
  city: string | null;
  address: string | null;
  remarks: string | null;
  assigned_to: string;
  assigned_to_user_id: number | null;
  follow_up_at: string | null;
  created_at: string;
  latest_score: string | null;
  score_reasoning: string | null;
  scored_at: string | null;
  contact_id: number | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_designation: string | null;
  contact_secondary_mobile: string | null;
  contact_primary_phone: string | null;
  contact_secondary_phone: string | null;
  contact_secondary_email: string | null;
  market_role: string | null;
  market_role_reasoning: string | null;
  producer_tier: string | null;
  producer_conversion_pct: number | null;
  producer_tier_reasoning: string | null;
}

export interface LeadTableRowUpdate {
  company_name?: string;
  country?: string;
  industry?: string;
  website_url?: string;
  linkedin_company_url?: string | null;
  facebook_company_url?: string | null;
  instagram_company_url?: string | null;
  legacy_serial_no?: number | null;
  company_grading?: string | null;
  product_interest?: string | null;
  city?: string | null;
  address?: string | null;
  remarks?: string | null;
  assigned_to?: string | null;
  assigned_to_user_id?: number | null;
  contact_id?: number;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
  contact_designation?: string | null;
  contact_secondary_mobile?: string | null;
  contact_primary_phone?: string | null;
  contact_secondary_phone?: string | null;
  contact_secondary_email?: string | null;
}

export interface LeadTableResponse {
  total: number;
  filtered_count: number;
  page: number;
  page_size: number;
  total_pages: number;
  rows: LeadTableRow[];
}

export interface LeadTableIdsResponse {
  filtered_count: number;
  ids: number[];
}

export interface DraftListResponse {
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  rows: DraftInteraction[];
}

export interface LeadTableFilters {
  countries: string[];
  industries: string[];
  sources: string[];
  scores: string[];
  market_roles: string[];
}

export interface LeadTableQuery {
  score?: string;
  country?: string;
  industry?: string;
  source?: string;
  exclude_source?: string;
  call_outcome?: string;
  market_role?: string;
  q?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
  page?: number;
  page_size?: number;
}

export type LeadTableSectionScope = Pick<LeadTableQuery, "source" | "exclude_source">;

export const client = {
  health: () => request<{ status: string }>("/health"),

  login: (data: { username: string; password: string }) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  getMe: () => request<AppUser>("/auth/me"),
  listUsers: () => request<AppUser[]>("/auth/users"),
  listAssignees: () => request<AppUser[]>("/auth/assignees"),
  createUser: (data: { username: string; full_name: string; password: string }) =>
    request<AppUser>("/auth/users", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  setUserActive: (userId: number, isActive: boolean) =>
    request<AppUser>(`/auth/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: isActive }),
    }),
  updateUser: (
    userId: number,
    data: {
      username?: string;
      full_name?: string;
      password?: string;
      is_active?: boolean;
    },
  ) =>
    request<AppUser>(`/auth/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteUser: (userId: number) =>
    request<void>(`/auth/users/${userId}`, { method: "DELETE" }),

  listLeads: (params: { page?: number; page_size?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.page_size) search.set("page_size", String(params.page_size));
    const query = search.toString();
    return request<LeadListResponse>(`/leads${query ? `?${query}` : ""}`);
  },
  listLeadTableFilters: () => request<LeadTableFilters>("/leads/table/filters"),
  listLeadsTable: (params: LeadTableQuery = {}) => {
    const search = new URLSearchParams();
    if (params.score) search.set("score", params.score);
    if (params.country) search.set("country", params.country);
    if (params.industry) search.set("industry", params.industry);
    if (params.source) search.set("source", params.source);
    if (params.exclude_source) search.set("exclude_source", params.exclude_source);
    if (params.call_outcome) search.set("call_outcome", params.call_outcome);
    if (params.market_role) search.set("market_role", params.market_role);
    if (params.q) search.set("q", params.q);
    if (params.sort_by) search.set("sort_by", params.sort_by);
    if (params.sort_dir) search.set("sort_dir", params.sort_dir);
    if (params.page) search.set("page", String(params.page));
    if (params.page_size) search.set("page_size", String(params.page_size));
    const query = search.toString();
    return request<LeadTableResponse>(`/leads/table${query ? `?${query}` : ""}`);
  },
  listLeadsTableIds: (params: Omit<LeadTableQuery, "page" | "page_size"> = {}) => {
    const search = new URLSearchParams();
    if (params.score) search.set("score", params.score);
    if (params.country) search.set("country", params.country);
    if (params.industry) search.set("industry", params.industry);
    if (params.source) search.set("source", params.source);
    if (params.exclude_source) search.set("exclude_source", params.exclude_source);
    if (params.call_outcome) search.set("call_outcome", params.call_outcome);
    if (params.market_role) search.set("market_role", params.market_role);
    if (params.q) search.set("q", params.q);
    if (params.sort_by) search.set("sort_by", params.sort_by);
    if (params.sort_dir) search.set("sort_dir", params.sort_dir);
    const query = search.toString();
    return request<LeadTableIdsResponse>(`/leads/table/ids${query ? `?${query}` : ""}`);
  },
  updateLeadTableRow: (leadId: number, data: LeadTableRowUpdate) =>
    request<LeadTableRow>(`/leads/table/${leadId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteLeadTableRow: (leadId: number) =>
    request<void>(`/leads/table/${leadId}`, { method: "DELETE" }),
  dedupeLeadsTable: (params: LeadTableSectionScope = {}) => {
    const search = new URLSearchParams();
    if (params.source) search.set("source", params.source);
    if (params.exclude_source) search.set("exclude_source", params.exclude_source);
    const query = search.toString();
    return request<LeadTableDedupeResponse>(
      `/leads/table/dedupe${query ? `?${query}` : ""}`,
      { method: "POST" },
    );
  },
  cleanupSparseCsvLeads: (params: LeadTableSectionScope = {}) => {
    const search = new URLSearchParams();
    if (params.source) search.set("source", params.source);
    if (params.exclude_source) search.set("exclude_source", params.exclude_source);
    const query = search.toString();
    return request<LeadTableCleanupResponse>(
      `/leads/table/cleanup-sparse${query ? `?${query}` : ""}`,
      { method: "POST" },
    );
  },
  createLead: (data: LeadCreate) =>
    request<Lead>("/leads", { method: "POST", body: JSON.stringify(data) }),
  getLead: (id: number) => request<Lead>(`/leads/${id}`),
  getLeadProfile: (id: number) => request<BuyerProfile>(`/leads/${id}/profile`),
  researchLead: (id: number) =>
    request<BuyerProfile>(`/leads/${id}/research`, { method: "POST" }),
  getLatestScore: (id: number) => request<LeadScore>(`/leads/${id}/score`),
  scoreLead: (id: number) =>
    request<LeadScore>(`/leads/${id}/score`, { method: "POST" }),
  onboardLead: (id: number) =>
    request<OnboardResult>(`/leads/${id}/onboard`, { method: "POST" }),
  listLeadContacts: (leadId: number) =>
    request<Contact[]>(`/leads/${leadId}/contacts`),
  createContact: (data: ContactCreate) =>
    request<Contact>("/leads/contacts", { method: "POST", body: JSON.stringify(data) }),
  updateContact: (contactId: number, data: ContactUpdate) =>
    request<Contact>(`/leads/contacts/${contactId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteContact: (contactId: number) =>
    request<void>(`/leads/contacts/${contactId}`, { method: "DELETE" }),

  listDiscoveryRegions: () =>
    request<DiscoveryRegionsResponse>("/leads/discover/regions"),

  discoverLeads: (data: DiscoverLeadsRequest) =>
    request<DiscoverLeadsResponse>("/leads/discover", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  enrichDiscoveryCandidate: (candidate: DiscoveryCandidate) =>
    request<DiscoveryCandidate>("/leads/discover/enrich", {
      method: "POST",
      body: JSON.stringify(candidate),
    }),

  discoverLeadsFromCsv: async (
    file: File,
    defaultCountry?: string,
    forLeadsTable = false,
    importSource?: string,
  ) => {
    const form = new FormData();
    form.append("file", file);
    const params = new URLSearchParams();
    if (defaultCountry) params.set("default_country", defaultCountry);
    if (forLeadsTable) params.set("for_leads_table", "true");
    if (importSource) params.set("import_source", importSource);
    const query = params.toString();
    const res = await fetch(`${API_BASE}/leads/discover/csv${query ? `?${query}` : ""}`, {
      method: "POST",
      body: form,
      headers: authHeaders(),
    });
    if (!res.ok) {
      let message = res.statusText;
      const text = await res.text();
      if (text) {
        try {
          const body = JSON.parse(text) as { detail?: string | string[] };
          if (typeof body.detail === "string") message = body.detail;
          else if (Array.isArray(body.detail)) message = body.detail.join("; ");
          else message = text;
        } catch {
          message = text;
        }
      }
      throw new Error(message);
    }
    return res.json() as Promise<DiscoverLeadsResponse>;
  },

  importDiscoveredLeads: (data: DiscoverImportRequest) =>
    request<DiscoverImportResponse>("/leads/discover/import", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getCrossSell: (leadId: number) =>
    request<CrossSellRecommendation[]>(`/leads/${leadId}/cross-sell`),

  listProductTypes: () =>
    request<{ count: number; product_types: ProductType[] }>("/leads/product-types").then(
      (r) => r.product_types,
    ),

  listDrafts: (params: { page?: number; page_size?: number } = {}) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.page_size) search.set("page_size", String(params.page_size));
    const query = search.toString();
    return request<DraftListResponse>(`/interactions/drafts${query ? `?${query}` : ""}`);
  },
  approveDraft: (id: number, content?: string, send = true) =>
    request<ApproveDraftResult>(`/interactions/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ content, approved_by: "dashboard_user", send }),
    }),
  rejectDraft: (id: number) =>
    request<DraftInteraction>(`/interactions/${id}/reject`, { method: "POST" }),
  createBulkEmailDrafts: (
    templateId: number,
    buyerIds: number[],
    attachments: EmailAttachment[] = [],
    send = true,
  ) =>
    request<BulkEmailDraftResponse>("/interactions/bulk-email-drafts", {
      method: "POST",
      body: JSON.stringify({
        template_id: templateId,
        buyer_ids: buyerIds,
        attachments,
        send,
      }),
    }),
  createBulkManualEmailDrafts: (
    buyerIds: number[],
    subject: string,
    body: string,
    attachments: EmailAttachment[] = [],
    send = true,
  ) =>
    request<BulkEmailDraftResponse>("/interactions/bulk-manual-email-drafts", {
      method: "POST",
      body: JSON.stringify({
        buyer_ids: buyerIds,
        subject,
        body,
        attachments,
        send,
      }),
    }),
  createManualEmailDraft: (data: {
    buyer_id: number;
    subject: string;
    body: string;
    contact_id?: number | null;
    attachments?: EmailAttachment[];
    send?: boolean;
  }) =>
    request<ManualEmailSendResult>("/interactions/manual-email-draft", {
      method: "POST",
      body: JSON.stringify({
        buyer_id: data.buyer_id,
        subject: data.subject,
        body: data.body,
        contact_id: data.contact_id ?? undefined,
        attachments: data.attachments ?? [],
        send: data.send ?? true,
      }),
    }),
  listEmailActivity: (params: { page?: number; page_size?: number; unread_only?: boolean } = {}) => {
    const search = new URLSearchParams();
    if (params.page) search.set("page", String(params.page));
    if (params.page_size) search.set("page_size", String(params.page_size));
    if (params.unread_only) search.set("unread_only", "true");
    const query = search.toString();
    return request<EmailActivityListResponse>(`/email-activity${query ? `?${query}` : ""}`);
  },
  getEmailActivityUnreadCount: () =>
    request<{ unread_count: number }>("/email-activity/unread-count"),
  listEmailActivityCatalog: () =>
    request<EmailActivityCatalogItem[]>("/email-activity/catalog"),
  markEmailActivityRead: (data: { event_ids?: number[]; mark_all?: boolean }) =>
    request<{ updated: number }>("/email-activity/mark-read", {
      method: "POST",
      body: JSON.stringify({
        event_ids: data.event_ids ?? [],
        mark_all: data.mark_all ?? false,
      }),
    }),
  bulkApproveDrafts: (interactionIds: number[], send = true) =>
    request<BulkApproveResponse>("/interactions/bulk-approve", {
      method: "POST",
      body: JSON.stringify({
        interaction_ids: interactionIds,
        approved_by: "dashboard_user",
        send,
      }),
    }),
  getBulkEmailSettings: () =>
    request<BulkEmailSettings>("/interactions/bulk-email-settings"),

  getDailyKpi: (params: {
    date: string;
    period?: KpiPeriod | string;
    user_id?: number | null;
  }) => {
    const search = new URLSearchParams();
    search.set("date", params.date);
    if (params.period) search.set("period", params.period);
    if (params.user_id != null) search.set("user_id", String(params.user_id));
    return request<DailyKpiReport>(`/kpi/daily?${search.toString()}`);
  },
  generateKpiSummary: (params: {
    date: string;
    period?: KpiPeriod | string;
    user_id?: number | null;
  }) =>
    request<KpiSummaryResponse>("/kpi/summary", {
      method: "POST",
      body: JSON.stringify({
        date: params.date,
        period: params.period ?? "day",
        user_id: params.user_id ?? null,
      }),
    }),

  getInboxStatus: () => request<InboxStatus>("/inbox/status"),
  resetInboxCutoff: () =>
    request<{ showing_since: string }>("/inbox/reset-cutoff", { method: "POST" }),
  clearInboxCutoff: () =>
    request<{ showing_since: string | null }>("/inbox/clear-cutoff", { method: "POST" }),
  getInboxUnreadCount: () => request<{ count: number }>("/inbox/unread-count"),
  listInboxThreads: (params: { limit?: number; unread_only?: boolean } = {}) => {
    const search = new URLSearchParams();
    if (params.limit) search.set("limit", String(params.limit));
    if (params.unread_only) search.set("unread_only", "true");
    const query = search.toString();
    return request<InboxThreadSummary[]>(`/inbox/threads${query ? `?${query}` : ""}`);
  },
  getInboxThread: (threadId: string) =>
    request<InboxThreadDetail>(`/inbox/threads/${encodeURIComponent(threadId)}`),
  replyInboxThread: (
    threadId: string,
    payload: { body: string; to?: string; subject?: string; cc?: string },
  ) =>
    request<InboxReplyResponse>(`/inbox/threads/${encodeURIComponent(threadId)}/reply`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  listInboxMessages: (params: { limit?: number; unread_only?: boolean } = {}) => {
    const search = new URLSearchParams();
    if (params.limit) search.set("limit", String(params.limit));
    if (params.unread_only) search.set("unread_only", "true");
    const query = search.toString();
    return request<InboxMessageSummary[]>(`/inbox/messages${query ? `?${query}` : ""}`);
  },
  getInboxMessage: (uid: string, folder = "INBOX") =>
    request<InboxMessageDetail>(
      `/inbox/messages/${encodeURIComponent(uid)}?folder=${encodeURIComponent(folder)}`,
    ),
  markInboxMessageRead: (uid: string, folder = "INBOX") =>
    request<{ count: number }>(
      `/inbox/messages/${encodeURIComponent(uid)}/read?folder=${encodeURIComponent(folder)}`,
      { method: "POST" },
    ),
  replyInboxMessage: (
    uid: string,
    payload: { body: string; to?: string; subject?: string; cc?: string; folder?: string },
  ) =>
    request<InboxReplyResponse>(`/inbox/messages/${encodeURIComponent(uid)}/reply`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  listEmailTemplates: () => request<EmailTemplate[]>("/email-templates"),
  getEmailTemplatePlaceholders: () =>
    request<{ placeholders: string[]; usage: string }>("/email-templates/placeholders"),
  createEmailTemplate: (data: {
    name: string;
    subject: string;
    body: string;
    attachments?: EmailAttachment[];
  }) =>
    request<EmailTemplate>("/email-templates", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  updateEmailTemplate: (
    id: number,
    data: Partial<{ name: string; subject: string; body: string; attachments: EmailAttachment[] }>,
  ) =>
    request<EmailTemplate>(`/email-templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteEmailTemplate: (id: number) =>
    request<void>(`/email-templates/${id}`, { method: "DELETE" }),
  previewEmailTemplate: (templateId: number, buyerId: number) =>
    request<EmailTemplatePreview>(`/email-templates/${templateId}/preview/${buyerId}`),
  previewEmailText: (buyerId: number, subject: string, body: string) =>
    request<EmailTemplatePreview>("/email-templates/preview-text", {
      method: "POST",
      body: JSON.stringify({ buyer_id: buyerId, subject, body }),
    }),

  uploadEmailAttachment: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/email/attachments`, {
      method: "POST",
      body: form,
      headers: authHeaders(),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { detail?: string }).detail || res.statusText);
    }
    return res.json() as Promise<EmailAttachment>;
  },

  updateDraftAttachments: (interactionId: number, attachments: EmailAttachment[]) =>
    request<DraftInteraction>(`/interactions/${interactionId}/attachments`, {
      method: "PATCH",
      body: JSON.stringify({ attachments }),
    }),

  getConsentSummary: () => request<ConsentSummary>("/compliance/summary"),
  listComplianceContacts: (params: { consent?: string; q?: string } = {}) => {
    const search = new URLSearchParams();
    if (params.consent) search.set("consent", params.consent);
    if (params.q) search.set("q", params.q);
    const query = search.toString();
    return request<ComplianceContact[]>(`/compliance/contacts${query ? `?${query}` : ""}`);
  },
  bulkUpdateConsent: (contactIds: number[], consentStatus: string) =>
    request<{ updated_count: number }>("/compliance/contacts/bulk", {
      method: "PATCH",
      body: JSON.stringify({ contact_ids: contactIds, consent_status: consentStatus }),
    }),
  updateComplianceContact: (
    contactId: number,
    data: {
      consent_status?: string;
      date_of_birth?: string;
      nationality?: string;
    },
  ) =>
    request<ComplianceContact>(`/compliance/contacts/${contactId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  getChatbotStatus: () => request<ChatbotStatus>("/chatbot/status"),
  sendChatbotMessage: async (payload: {
    message: string;
    image?: File;
    history?: ChatMessage[];
  }): Promise<ChatResponse> => {
    const form = new FormData();
    form.append("message", payload.message);
    form.append("history", JSON.stringify(payload.history ?? []));
    if (payload.image) form.append("image", payload.image);
    const res = await fetch(`${API_BASE}/chatbot/chat`, {
      method: "POST",
      body: form,
      headers: authHeaders(),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || res.statusText);
    }
    return res.json() as Promise<ChatResponse>;
  },

  getCallConfig: () => request<CallConfig>("/calls/config"),
  listInterestedFollowUps: () =>
    request<InterestedFollowUp[]>("/leads/interested-follow-ups"),
  acknowledgeInterestedFollowUp: (buyerId: number) =>
    request<{ buyer_id: number; interested_follow_up_ack_at: string; follow_up_at: null }>(
      `/leads/interested-follow-ups/${buyerId}/acknowledge`,
      { method: "POST" },
    ),
  scheduleInterestedFollowUp: (buyerId: number, followUpAt: string | null) =>
    request<{ buyer_id: number; follow_up_at: string | null }>(
      `/leads/interested-follow-ups/${buyerId}`,
      {
        method: "PATCH",
        body: JSON.stringify({ follow_up_at: followUpAt }),
      },
    ),
  getVoiceToken: () => request<VoiceToken>("/calls/voice-token"),
  listCallHistory: (params: { page?: number; page_size?: number; since_days?: number } = {}) => {
    const search = new URLSearchParams();
    search.set("page", String(params.page ?? 1));
    search.set("page_size", String(params.page_size ?? 5));
    if (params.since_days != null) search.set("since_days", String(params.since_days));
    return request<CallHistoryListResponse>(`/calls/history?${search}`);
  },
  listLeadCalls: (
    leadId: number,
    params: { page?: number; page_size?: number; since_days?: number | null } = {},
  ) => {
    const search = new URLSearchParams();
    search.set("page", String(params.page ?? 1));
    search.set("page_size", String(params.page_size ?? 5));
    if (params.since_days != null) search.set("since_days", String(params.since_days));
    return request<CallHistoryListResponse>(`/leads/${leadId}/calls?${search}`);
  },
  updateCallNotes: (interactionId: number, notes: string) =>
    request<CallHistoryItem>(`/calls/${interactionId}/notes`, {
      method: "PATCH",
      body: JSON.stringify({ notes }),
    }),
  updateCallFollowUp: (
    interactionId: number,
    data: { notes?: string; call_outcome?: string | null },
  ) =>
    request<CallHistoryItem>(`/calls/${interactionId}/notes`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteCallLog: (interactionId: number) =>
    request<void>(`/calls/${interactionId}`, { method: "DELETE" }),
  getCallRecordingUrl: (interactionId: number, download = false) =>
    `${API_BASE}/calls/${interactionId}/recording${download ? "?download=1" : ""}`,
  /** Authenticated fetch — browser <audio>/<a href> cannot send Bearer tokens. */
  fetchCallRecordingBlob: async (interactionId: number, download = false) => {
    const token = getStoredToken();
    const url = `${API_BASE}/calls/${interactionId}/recording${download ? "?download=1" : ""}`;
    const res = await fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (res.status === 401) {
      clearSession();
      window.dispatchEvent(new Event("kafi:auth-expired"));
    }
    if (!res.ok) {
      const text = await res.text();
      throw new Error(parseErrorDetail(text, res.statusText || "Failed to load recording"));
    }
    const blob = await res.blob();
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = /filename="?([^"]+)"?/i.exec(disposition);
    const filename = match?.[1] || `call-${interactionId}.mp3`;
    return { blob, filename, contentType: blob.type || "audio/mpeg" };
  },
  transcribeCall: (interactionId: number, wait = false) =>
    request<CallHistoryItem>(
      `/calls/${interactionId}/transcribe${wait ? "?wait=true" : ""}`,
      { method: "POST" },
    ),
  initiateLeadCall: (
    leadId: number,
    data: { contact_id?: number } = {},
  ) =>
    request<CallInitiateResult>(`/leads/${leadId}/call`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  initiateManualCall: (data: {
    phone: string;
    contact_name?: string;
    country?: string;
  }) =>
    request<CallInitiateResult>("/calls/dial", {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
