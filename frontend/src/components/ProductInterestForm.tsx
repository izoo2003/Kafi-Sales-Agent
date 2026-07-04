import { useCallback, useEffect, useMemo, useState } from "react";
import {
  client,
  type Contact,
  type ProductType,
  type QuotationEligibleLead,
} from "../api/client";
import { ScoreBadge } from "./ScoreBadge";

function formatCategory(category: string): string {
  return category.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export interface SuggestedProduct {
  name: string;
  category?: string;
  type_key?: string;
  matched_keyword?: string;
}

function normalizeTypeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function matchSuggestedToTypeKeys(
  suggested: SuggestedProduct[],
  productTypes: ProductType[],
): Set<string> {
  const keys = new Set<string>();
  if (productTypes.length === 0) return keys;

  const byKey = new Map(
    productTypes.map((t) => [normalizeTypeKey(t.type_key), t.type_key]),
  );
  const byName = new Map(productTypes.map((t) => [t.name.toLowerCase(), t.type_key]));
  const byCategory = new Map<string, ProductType[]>();
  for (const productType of productTypes) {
    const list = byCategory.get(productType.category) ?? [];
    list.push(productType);
    byCategory.set(productType.category, list);
  }

  for (const item of suggested) {
    if (item.type_key) {
      const normalized = normalizeTypeKey(item.type_key);
      if (byKey.has(normalized)) {
        keys.add(byKey.get(normalized)!);
        continue;
      }
    }

    const nameLower = item.name.toLowerCase();
    if (byName.has(nameLower)) {
      keys.add(byName.get(nameLower)!);
      continue;
    }

    const fuzzy = productTypes.find(
      (t) =>
        nameLower === t.name.toLowerCase() ||
        nameLower === normalizeTypeKey(t.type_key) ||
        nameLower.includes(t.name.toLowerCase()) ||
        t.name.toLowerCase().includes(nameLower) ||
        nameLower.includes(normalizeTypeKey(t.type_key)) ||
        normalizeTypeKey(t.type_key).includes(nameLower),
    );
    if (fuzzy) {
      keys.add(fuzzy.type_key);
      continue;
    }

    if (item.category && byCategory.has(item.category)) {
      const categoryTypes = byCategory.get(item.category)!;
      const nameTokens = nameLower.split(/[^a-z0-9]+/).filter((t) => t.length >= 3);
      const categoryHit = categoryTypes.find((t) => {
        const typeTokens = `${t.name} ${t.type_key}`.toLowerCase().split(/[^a-z0-9]+/);
        return nameTokens.some((token) => typeTokens.some((part) => part.includes(token) || token.includes(part)));
      });
      if (categoryHit) {
        keys.add(categoryHit.type_key);
      }
    }
  }

  return keys;
}

function countUnmappedSuggested(
  suggested: SuggestedProduct[],
  productTypes: ProductType[],
): number {
  return suggested.filter(
    (item) => matchSuggestedToTypeKeys([item], productTypes).size === 0,
  ).length;
}

function isValidEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const value = email.trim();
  if (!value || value.toLowerCase() === "not found") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function dedupeSuggested(suggested: SuggestedProduct[]): SuggestedProduct[] {
  const seen = new Set<string>();
  const out: SuggestedProduct[] = [];
  for (const s of suggested) {
    const key = s.type_key ?? s.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

interface ProductInterestFormProps {
  buyerId: number;
  buyerLabel: string;
  scoreLabel?: string;
  productTypes: ProductType[];
  contacts: Contact[];
  suggestedProducts?: SuggestedProduct[];
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export function ProductInterestForm({
  buyerId,
  buyerLabel,
  scoreLabel,
  productTypes,
  contacts,
  suggestedProducts = [],
  onSuccess,
  onError,
}: ProductInterestFormProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [contactId, setContactId] = useState("");
  const [search, setSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const suggested = useMemo(
    () => dedupeSuggested(suggestedProducts),
    [suggestedProducts],
  );

  const suggestedKeys = useMemo(
    () => matchSuggestedToTypeKeys(suggested, productTypes),
    [suggested, productTypes],
  );

  const unmappedSuggestedCount = useMemo(
    () => countUnmappedSuggested(suggested, productTypes),
    [suggested, productTypes],
  );

  useEffect(() => {
    const withEmail = contacts.filter((c) => isValidEmail(c.email));
    if (withEmail.length > 0) {
      setContactId(String(withEmail[0].id));
    }
  }, [contacts]);

  useEffect(() => {
    setSelected(new Set(suggestedKeys));
  }, [suggestedKeys]);

  const filteredTypes = productTypes.filter((p) => {
    const q = search.toLowerCase();
    if (!q) return true;
    return (
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.type_key.includes(q)
    );
  });

  const grouped = useMemo(() => {
    const map = new Map<string, ProductType[]>();
    for (const p of filteredTypes) {
      const cat = p.category || "other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(p);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [filteredTypes]);

  function toggleType(typeKey: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(typeKey)) next.delete(typeKey);
      else next.add(typeKey);
      return next;
    });
  }

  function selectSuggested() {
    setSelected(new Set(suggestedKeys));
  }

  async function handleDraftEmail() {
    if (selected.size === 0) {
      onError("Select at least one product");
      return;
    }
    if (!contactId) {
      onError("Select a contact with an email address");
      return;
    }

    const chosen = productTypes
      .filter((p) => selected.has(p.type_key))
      .map((p) => ({ name: p.name, category: p.category }));

    setSubmitting(true);
    try {
      await client.createProductInterestEmail(buyerId, {
        contact_id: Number(contactId),
        products: chosen,
      });
      onSuccess(
        `Email draft created for ${buyerLabel}. Review it in the Approval Queue, then Approve & Send.`,
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to create email draft");
    } finally {
      setSubmitting(false);
    }
  }

  const contactsWithEmail = contacts.filter((c) => isValidEmail(c.email));

  return (
    <section className="rounded-xl border border-emerald-500/20 bg-slate-900 p-5 space-y-4">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="text-sm font-medium text-slate-300">Product interest outreach</h3>
          {scoreLabel && <ScoreBadge score={scoreLabel} />}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          One line per product type (sizes grouped). Draft email → Approval Queue → send.
        </p>
      </div>

      {contactsWithEmail.length === 0 ? (
        <p className="text-sm text-amber-400/90">
          Add a contact with an email address for this lead before drafting outreach.
        </p>
      ) : (
        <label className="block">
          <span className="text-xs text-slate-400">Send to</span>
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
          >
            {contactsWithEmail.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name} ({c.email})
              </option>
            ))}
          </select>
        </label>
      )}

      {suggested.length > 0 && (
        <div className="rounded-lg bg-slate-950 border border-slate-800 p-3">
          <p className="text-xs text-slate-400 mb-1">Suggested from website &amp; profile fit</p>
          <p className="text-[11px] text-slate-500 mb-2">
            Inferred from keywords on their site (product names, categories, industry) — not an
            explicit order list from the buyer.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {suggested.map((p) => (
              <span
                key={p.type_key ?? p.name}
                title={
                  p.matched_keyword
                    ? `Matched catalog keyword: ${p.matched_keyword}`
                    : p.category
                      ? `Category fit: ${formatCategory(p.category)}`
                      : undefined
                }
                className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
              >
                {p.name}
                {p.matched_keyword ? ` · ${p.matched_keyword}` : ""}
              </span>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={selectSuggested}
              className="text-xs text-emerald-400 hover:text-emerald-300"
            >
              Select all suggested ({suggestedKeys.size})
            </button>
            {unmappedSuggestedCount > 0 && (
              <span className="text-[11px] text-amber-400/90">
                {unmappedSuggestedCount} suggestion
                {unmappedSuggestedCount === 1 ? "" : "s"} could not be mapped to a product type
              </span>
            )}
          </div>
        </div>
      )}

      <div>
        <input
          type="search"
          placeholder="Search product types…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600"
        />
        <p className="text-xs text-slate-500 mt-1">
          {selected.size} of {productTypes.length} product types selected
        </p>
      </div>

      <div className="max-h-64 overflow-y-auto space-y-3 pr-1">
        {grouped.map(([category, items]) => (
          <div key={category}>
            <p className="text-xs font-medium text-slate-500 mb-1 sticky top-0 bg-slate-900 py-1">
              {formatCategory(category)}
            </p>
            <ul className="space-y-1">
              {items.map((p) => (
                <li key={p.type_key}>
                  <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer hover:text-slate-100">
                    <input
                      type="checkbox"
                      checked={selected.has(p.type_key)}
                      onChange={() => toggleType(p.type_key)}
                      className="mt-1 rounded border-slate-600"
                    />
                    <span>{p.name}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <button
        type="button"
        onClick={handleDraftEmail}
        disabled={submitting || selected.size === 0 || contactsWithEmail.length === 0}
        title={
          contactsWithEmail.length === 0
            ? "Add a contact with an email address for this lead first"
            : selected.size === 0
              ? "Select at least one product"
              : undefined
        }
        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
      >
        {submitting
          ? "Drafting…"
          : contactsWithEmail.length === 0
            ? "Draft email — add contact email first"
            : `Draft email (${selected.size} products)`}
      </button>
    </section>
  );
}

interface ProductInterestOutreachProps {
  leads: QuotationEligibleLead[];
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
}

export function ProductInterestOutreach({
  leads,
  onSuccess,
  onError,
}: ProductInterestOutreachProps) {
  const [buyerId, setBuyerId] = useState(leads[0] ? String(leads[0].id) : "");
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [suggested, setSuggested] = useState<SuggestedProduct[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    client.listProductTypes().then(setProductTypes).catch(() => setProductTypes([]));
  }, []);

  const loadBuyerContext = useCallback(async () => {
    if (!buyerId) return;
    setLoading(true);
    try {
      const [contactList, profile] = await Promise.all([
        client.listLeadContacts(Number(buyerId)),
        client.getLeadProfile(Number(buyerId)).catch(() => null),
      ]);
      setContacts(contactList);
      setSuggested(
        (profile?.matched_products ?? []).map((product) => ({
          name: String(product.name ?? ""),
          category: product.category ? String(product.category) : undefined,
          type_key: product.type_key ? String(product.type_key) : undefined,
          matched_keyword: product.matched_keyword
            ? String(product.matched_keyword)
            : undefined,
        })),
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load lead context");
    } finally {
      setLoading(false);
    }
  }, [buyerId, onError]);

  useEffect(() => {
    loadBuyerContext();
  }, [loadBuyerContext]);

  if (leads.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-slate-700 bg-slate-900/50 p-5">
        <p className="text-sm text-slate-400">
          No HOT or WARM leads with a contact email yet. Score a lead, ensure a valid email is on
          file (from discovery or manual entry), then select products and draft an email.
        </p>
      </section>
    );
  }

  const selectedLead = leads.find((l) => String(l.id) === buyerId);

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-xs text-slate-400">Buyer (HOT / WARM with email)</span>
        <select
          value={buyerId}
          onChange={(e) => setBuyerId(e.target.value)}
          className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
        >
          {leads.map((lead) => (
            <option key={lead.id} value={lead.id}>
              {lead.company_name} — {lead.latest_score} ({lead.contact_email})
            </option>
          ))}
        </select>
        {selectedLead && (
          <p className="text-xs text-slate-500 mt-1 line-clamp-2">
            {selectedLead.score_reasoning}
          </p>
        )}
      </label>

      {loading ? (
        <p className="text-sm text-slate-400">Loading products and contacts…</p>
      ) : (
        <ProductInterestForm
          buyerId={Number(buyerId)}
          buyerLabel={selectedLead?.company_name ?? "buyer"}
          scoreLabel={selectedLead?.latest_score}
          productTypes={productTypes}
          contacts={contacts}
          suggestedProducts={suggested}
          onSuccess={onSuccess}
          onError={onError}
        />
      )}
    </div>
  );
}
