import { useCallback, useEffect, useState } from "react";
import { client } from "../api/client";
import { ProductInterestOutreach } from "../components/ProductInterestForm";

interface QuotationsPageProps {
  onError: (message: string) => void;
}

export function QuotationsPage({ onError }: QuotationsPageProps) {
  const [eligibleLeads, setEligibleLeads] = useState<
    Awaited<ReturnType<typeof client.listQuotationEligibleLeads>>
  >([]);
  const [loading, setLoading] = useState(true);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const loadMeta = useCallback(async () => {
    setLoading(true);
    try {
      setEligibleLeads(await client.listQuotationEligibleLeads());
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to load outreach data");
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  if (loading) {
    return <p className="text-slate-400">Loading…</p>;
  }

  return (
    <section className="space-y-4">
      {successMessage && (
        <p className="text-sm text-emerald-300/90 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
          {successMessage}
        </p>
      )}

      <ProductInterestOutreach
        leads={eligibleLeads}
        onSuccess={(msg) => {
          setSuccessMessage(msg);
          setTimeout(() => setSuccessMessage(null), 8000);
        }}
        onError={onError}
      />

      <p className="text-xs text-slate-500">
        After drafting, open the <strong className="text-slate-400">Approval Queue</strong> tab to
        review, edit, and send the email.
      </p>
    </section>
  );
}
