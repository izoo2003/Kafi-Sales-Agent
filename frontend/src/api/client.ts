/**
 * Single API client for the FastAPI backend.
 * All pages/hooks must call through here — never scatter fetch() elsewhere.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...options?.headers },
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

export interface DraftInteraction {
  id: number;
  contact_id: number;
  channel: string;
  subject: string | null;
  content: string;
  status: string;
  created_at: string;
}

export interface ApproveDraftResult {
  interaction: DraftInteraction;
  sent: boolean;
  send_status: string | null;
  send_message: string | null;
}

export interface QuotationLine {
  product_id: number;
  product_name?: string | null;
  quantity: number;
  unit_price: number;
  price_unit?: string | null;
  line_total: number;
}

export interface Quotation {
  id: number;
  buyer_id: number;
  product_id: number | null;
  quantity: number | null;
  unit_price: number | null;
  incoterms: string | null;
  validity_date: string | null;
  status: string;
  pdf_path: string | null;
  buyer_name?: string | null;
  product_name?: string | null;
  price_unit?: string | null;
  line_total?: number | null;
  lines?: QuotationLine[];
  grand_total?: number | null;
}

export interface CategoryPricing {
  category: string;
  unit: string;
  price_tiers: Record<string, number>;
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

export interface Product {
  id: number;
  name: string;
  category: string | null;
  price_tiers: Record<string, number> | null;
  moq: string | null;
}

export interface QuotationLineCreate {
  product_id: number;
  quantity: number;
  price_tier?: string;
}

export interface QuotationCreate {
  buyer_id: number;
  lines: QuotationLineCreate[];
  incoterms?: string;
  validity_days?: number;
}

export interface QuotationBatchCreate {
  quantity?: number;
  incoterms?: string;
  max_quotes?: number;
}

export interface QuotationEligibleLead extends Lead {
  latest_score: string;
  score_reasoning: string;
  contact_email: string;
  contact_name?: string | null;
}

export interface CatalogSyncResult {
  created: number;
  skipped: number;
  total: number;
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
}

export interface DiscoverImportResponse {
  created_count: number;
  skipped_count: number;
  created: Lead[];
  skipped: Array<{ company_name: string; reason: string }>;
  onboard_results: Array<Record<string, unknown>>;
}

export interface LeadTableRow {
  id: number;
  company_name: string;
  country: string | null;
  industry: string | null;
  website_url: string | null;
  linkedin_company_url: string | null;
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
  linkedin_company_url?: string;
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
    data: { contact_id?: number; products: Array<{ name: string; category?: string }> },
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

  discoverLeadsFromCsv: async (file: File, defaultCountry?: string) => {
    const form = new FormData();
    form.append("file", file);
    const params = defaultCountry
      ? `?default_country=${encodeURIComponent(defaultCountry)}`
      : "";
    const res = await fetch(`${API_BASE}/leads/discover/csv${params}`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(text || res.statusText);
    }
    return res.json() as Promise<DiscoverLeadsResponse>;
  },

  importDiscoveredLeads: (data: DiscoverImportRequest) =>
    request<DiscoverImportResponse>("/leads/discover/import", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  getCrossSell: (leadId: number) =>
    request<CrossSellRecommendation[]>(`/quotations/cross-sell/${leadId}`),

  listDrafts: () => request<DraftInteraction[]>("/interactions/drafts"),
  approveDraft: (id: number, content?: string, send = true) =>
    request<ApproveDraftResult>(`/interactions/${id}/approve`, {
      method: "POST",
      body: JSON.stringify({ content, approved_by: "dashboard_user", send }),
    }),
  rejectDraft: (id: number) =>
    request<DraftInteraction>(`/interactions/${id}/reject`, { method: "POST" }),

  listQuotations: () => request<Quotation[]>("/quotations"),
  listQuotationsForLead: (leadId: number) =>
    request<Quotation[]>(`/quotations?buyer_id=${leadId}`),
  listProductTypes: () =>
    request<{ count: number; product_types: ProductType[] }>("/quotations/product-types").then(
      (r) => r.product_types,
    ),
  listProducts: () => request<Product[]>("/quotations/products"),
  syncProductsFromCatalog: () =>
    request<CatalogSyncResult>("/quotations/products/sync", { method: "POST" }),
  createQuotation: (data: QuotationCreate) =>
    request<Quotation>("/quotations", { method: "POST", body: JSON.stringify(data) }),
  createQuotationsForLead: (leadId: number, data?: QuotationBatchCreate) =>
    request<Quotation[]>(`/quotations/for-lead/${leadId}`, {
      method: "POST",
      body: JSON.stringify(data ?? {}),
    }),
  quotationFileUrl: (quotationId: number) =>
    `${API_BASE}/quotations/${quotationId}/file`,
  approveQuotation: (quotationId: number) =>
    request<Quotation>(`/quotations/${quotationId}/approve`, { method: "POST" }),
  createQuotationEmailDraft: (quotationId: number) =>
    request<DraftInteraction>(`/quotations/${quotationId}/email-draft`, { method: "POST" }),
  listCategoryPricing: () =>
    request<{ categories: CategoryPricing[] }>("/quotations/pricing"),

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
};
