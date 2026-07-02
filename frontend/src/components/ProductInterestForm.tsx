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
}

function matchSuggestedToTypeKeys(
  suggested: SuggestedProduct[],
  productTypes: ProductType[],
): Set<string> {
  const keys = new Set<string>();
  for (const s of suggested) {
    if (s.type_key) {
      keys.add(s.type_key);
      continue;
    }
    const sl = s.name.toLowerCase();
    const hit = productTypes.find(
      (t) =>
        t.name.toLowerCase() === sl ||
        t.type_key === sl ||
        sl.includes(t.type_key) ||
        t.type_key.includes(sl),
    );
    if (hit) keys.add(hit.type_key);
  }
  return keys;
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

  useEffect(() => {
    const withEmail = contacts.filter((c) => c.email);
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

  const contactsWithEmail = contacts.filter((c) => c.email);

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
          <p className="text-xs text-slate-400 mb-2">Suggested from research</p>
          <div className="flex flex-wrap gap-1.5">
            {suggested.slice(0, 12).map((p) => (
              <span
                key={p.type_key ?? p.name}
                className="text-xs px-2 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-300"
              >
                {p.name}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={selectSuggested}
            className="mt-2 text-xs text-emerald-400 hover:text-emerald-300"
          >
            Select all suggested
          </button>
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
        className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-sm font-medium disabled:opacity-50"
      >
        {submitting ? "Drafting…" : `Draft email (${selected.size} products)`}
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
        client.researchLead(Number(buyerId)).catch(() => null),
      ]);
      setContacts(contactList);
      setSuggested(profile?.matched_products ?? []);
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
          No HOT or WARM leads yet. Score a lead first, then select products and draft an email.
        </p>
      </section>
    );
  }

  const selectedLead = leads.find((l) => String(l.id) === buyerId);

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="text-xs text-slate-400">Buyer (HOT / WARM only)</span>
        <select
          value={buyerId}
          onChange={(e) => setBuyerId(e.target.value)}
          className="mt-1 w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
        >
          {leads.map((lead) => (
            <option key={lead.id} value={lead.id}>
              {lead.company_name} — {lead.latest_score}
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
