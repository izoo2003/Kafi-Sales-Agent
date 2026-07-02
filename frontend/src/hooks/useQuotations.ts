import { useCallback, useEffect, useState } from "react";
import { client, type Quotation } from "../api/client";

export function useQuotations() {
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setQuotations(await client.listQuotations());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load quotations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { quotations, loading, error, refresh };
}
