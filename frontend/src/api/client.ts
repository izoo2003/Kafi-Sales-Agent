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
  return res.json();
}

export interface Lead {
  id: number;
  company_name: string;
  website_url: string | null;
  country: string | null;
  industry: string | null;
  source: string | null;
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
    matched_keyword?: string;
  }>;
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

export interface Quotation {
  id: number;
  buyer_id: number;
  product_id: number;
  quantity: number;
  unit_price: number;
  incoterms: string | null;
  validity_date: string | null;
  status: string;
  pdf_path: string | null;
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

export interface QuotationCreate {
  buyer_id: number;
  product_id: number;
  quantity: number;
  incoterms?: string;
  validity_days?: number;
  price_tier?: string;
}

export interface QuotationBatchCreate {
  quantity?: number;
  incoterms?: string;
  max_quotes?: number;
}

export interface QuotationEligibleLead extends Lead {
  latest_score: string;
  score_reasoning: string;
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
  email: string | null;
  phone: string | null;
  preferred_language: string | null;
}

export interface ContactCreate {
  buyer_id: number;
  full_name: string;
  designation?: string;
  email?: string;
  phone?: string;
  preferred_language?: string;
}

export interface DiscoveryCandidate {
  candidate_id: string;
  company_name: string;
  website_url: string | null;
  country: string | null;
  industry: string | null;
  source: string;
  source_detail: string;
  match_reason: string;
  already_exists: boolean;
}

export interface DiscoverLeadsRequest {
  seed_lead_id?: number;
  country?: string;
  industry?: string;
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

export const client = {
  health: () => request<{ status: string }>("/health"),

  listLeads: () => request<Lead[]>("/leads"),
  createLead: (data: LeadCreate) =>
    request<Lead>("/leads", { method: "POST", body: JSON.stringify(data) }),
  getLead: (id: number) => request<Lead>(`/leads/${id}`),
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
};
