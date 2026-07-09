/**
 * Single API client for the FastAPI backend.
 * All pages/hooks must call through here — never scatter fetch() elsewhere.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

/** External quotation agent (separate app). */
export const QUOTATION_AGENT_URL =
  import.meta.env.VITE_QUOTATION_AGENT_URL ??
  "https://bank-recon-demo.vercel.app/quotations";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
    ...options,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  const text = await res.text();
  if (!text) {
    return undefined as T;
  }
  return JSON.parse(text) as T;
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
  provider?: string | null;
  subject: string;
  from_email: string | null;
  from_name: string | null;
  date: string | null;
  preview: string;
  unread: boolean;
  has_attachments: boolean;
  message_id: string | null;
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

export interface InboxReplyResponse {
  status: string;
  message: string;
  to: string | null;
  subject: string | null;
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
  created: Array<{
    buyer_id: number;
    company_name: string;
    interaction_id: number;
    contact_id: number;
  }>;
  skipped: Array<{
    buyer_id: number;
    company_name?: string | null;
    reason: string;
  }>;
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

export interface QuotationEligibleLead extends Lead {
  latest_score: string;
  score_reasoning: string;
  contact_email: string;
  contact_name?: string | null;
}

export interface OnboardResult {
  buyer_id: number;
  score: string;
  reasoning: string;
  next_actions: string[];
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
}

export interface DiscoverLeadsResponse {
  candidates: DiscoveryCandidate[];
  sources_used: string[];
  messages: string[];
  search_query: string | null;
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
    source?: string;
  }>;
  auto_onboard?: boolean;
  replace_duplicates?: boolean;
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
  created_at: string;
  latest_score: string | null;
  score_reasoning: string | null;
  scored_at: string | null;
  contact_id: number | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
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
  contact_id?: number;
  contact_name?: string;
  contact_email?: string;
  contact_phone?: string;
}

export interface LeadTableResponse {
  total: number;
  filtered_count: number;
  rows: LeadTableRow[];
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
  market_role?: string;
  q?: string;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
}

export const client = {
  health: () => request<{ status: string }>("/health"),

  listLeads: () => request<Lead[]>("/leads"),
  listLeadTableFilters: () => request<LeadTableFilters>("/leads/table/filters"),
  listLeadsTable: (params: LeadTableQuery = {}) => {
    const search = new URLSearchParams();
    if (params.score) search.set("score", params.score);
    if (params.country) search.set("country", params.country);
    if (params.industry) search.set("industry", params.industry);
    if (params.source) search.set("source", params.source);
    if (params.market_role) search.set("market_role", params.market_role);
    if (params.q) search.set("q", params.q);
    if (params.sort_by) search.set("sort_by", params.sort_by);
    if (params.sort_dir) search.set("sort_dir", params.sort_dir);
    const query = search.toString();
    return request<LeadTableResponse>(`/leads/table${query ? `?${query}` : ""}`);
  },
  updateLeadTableRow: (leadId: number, data: LeadTableRowUpdate) =>
    request<LeadTableRow>(`/leads/table/${leadId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  deleteLeadTableRow: (leadId: number) =>
    request<void>(`/leads/table/${leadId}`, { method: "DELETE" }),
  dedupeLeadsTable: () =>
    request<LeadTableDedupeResponse>("/leads/table/dedupe", { method: "POST" }),
  cleanupSparseCsvLeads: () =>
    request<LeadTableCleanupResponse>("/leads/table/cleanup-sparse", { method: "POST" }),
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
  listQuotationEligibleLeads: () =>
    request<QuotationEligibleLead[]>("/leads/quotation-eligible"),
  listLeadContacts: (leadId: number) =>
    request<Contact[]>(`/leads/${leadId}/contacts`),
  createProductInterestEmail: (
    leadId: number,
    data: {
      contact_id?: number;
      products: Array<{ name: string; category?: string }>;
      attachments?: EmailAttachment[];
    },
  ) =>
    request<DraftInteraction>(`/leads/${leadId}/product-interest-email`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

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

  discoverLeadsFromCsv: async (file: File, defaultCountry?: string, forLeadsTable = false) => {
    const form = new FormData();
    form.append("file", file);
    const params = new URLSearchParams();
    if (defaultCountry) params.set("default_country", defaultCountry);
    if (forLeadsTable) params.set("for_leads_table", "true");
    const query = params.toString();
    const res = await fetch(`${API_BASE}/leads/discover/csv${query ? `?${query}` : ""}`, {
      method: "POST",
      body: form,
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

  listDrafts: () => request<DraftInteraction[]>("/interactions/drafts"),
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
  ) =>
    request<BulkEmailDraftResponse>("/interactions/bulk-email-drafts", {
      method: "POST",
      body: JSON.stringify({
        template_id: templateId,
        buyer_ids: buyerIds,
        attachments,
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

  getInboxStatus: () => request<InboxStatus>("/inbox/status"),
  resetInboxCutoff: () =>
    request<{ showing_since: string }>("/inbox/reset-cutoff", { method: "POST" }),
  getInboxUnreadCount: () => request<{ count: number }>("/inbox/unread-count"),
  listInboxMessages: (params: { limit?: number; unread_only?: boolean } = {}) => {
    const search = new URLSearchParams();
    if (params.limit) search.set("limit", String(params.limit));
    if (params.unread_only) search.set("unread_only", "true");
    const query = search.toString();
    return request<InboxMessageSummary[]>(`/inbox/messages${query ? `?${query}` : ""}`);
  },
  getInboxMessage: (uid: string) =>
    request<InboxMessageDetail>(`/inbox/messages/${encodeURIComponent(uid)}`),
  markInboxMessageRead: (uid: string) =>
    request<{ count: number }>(`/inbox/messages/${encodeURIComponent(uid)}/read`, {
      method: "POST",
    }),
  replyInboxMessage: (
    uid: string,
    payload: { body: string; to?: string; subject?: string; cc?: string },
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

  uploadEmailAttachment: async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/email/attachments`, { method: "POST", body: form });
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

  getCallConfig: () => request<CallConfig>("/calls/config"),
  getVoiceToken: () => request<VoiceToken>("/calls/voice-token"),
  listCallHistory: (limit = 50) =>
    request<CallHistoryItem[]>(`/calls/history?limit=${limit}`),
  listLeadCalls: (leadId: number, limit = 50) =>
    request<CallHistoryItem[]>(`/leads/${leadId}/calls?limit=${limit}`),
  updateCallNotes: (interactionId: number, notes: string) =>
    request<CallHistoryItem>(`/calls/${interactionId}/notes`, {
      method: "PATCH",
      body: JSON.stringify({ notes }),
    }),
  initiateLeadCall: (
    leadId: number,
    data: { contact_id?: number } = {},
  ) =>
    request<CallInitiateResult>(`/leads/${leadId}/call`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
};
