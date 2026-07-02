import { useCallback, useEffect, useState } from "react";
import { client, type Contact, type LeadScore, type ProductType } from "../api/client";
import { ProductInterestForm, type SuggestedProduct } from "./ProductInterestForm";

interface ProductInterestPanelProps {
  leadId: number;
  leadName: string;
  score: LeadScore | null;
  suggestedProducts?: SuggestedProduct[];
  onError: (message: string) => void;
  onDraftCreated?: (message: string) => void;
}

export function ProductInterestPanel({
  leadId,
  leadName,
  score,
  suggestedProducts = [],
  onError,
  onDraftCreated,
}: ProductInterestPanelProps) {
  const [productTypes, setProductTypes] = useState<ProductType[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [types, contactList] = await Promise.all([
        client.listProductTypes(),
        client.listLeadContacts(leadId),
      ]);
      setProductTypes(types);
      setContacts(contactList);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load product interest data");
    } finally {
      setLoading(false);
    }
  }, [leadId, onError]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!score) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-medium text-slate-300 mb-2">Product interest outreach</h3>
        <p className="text-sm text-slate-500">
          Score this lead first (Research &amp; Score), then select products and draft an email.
        </p>
      </section>
    );
  }

  const canOutreach = score.score === "HOT" || score.score === "WARM";

  if (!canOutreach) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-900 p-5">
        <h3 className="text-sm font-medium text-slate-300 mb-2">Product interest outreach</h3>
        <p className="text-sm text-slate-500">
          This lead is <strong className="text-slate-400">COLD</strong>. Outreach is available for
          HOT and WARM leads only.
        </p>
      </section>
    );
  }

  if (loading) {
    return <p className="text-slate-400 text-sm">Loading products…</p>;
  }

  return (
    <ProductInterestForm
      buyerId={leadId}
      buyerLabel={leadName}
      scoreLabel={score.score}
      productTypes={productTypes}
      contacts={contacts}
      suggestedProducts={suggestedProducts}
      onSuccess={(msg) => onDraftCreated?.(msg)}
      onError={onError}
    />
  );
}
