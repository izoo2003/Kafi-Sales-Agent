import { useCallback, useEffect, useState } from "react";
import { client, type DraftInteraction } from "../api/client";

export function useDrafts() {
  const [drafts, setDrafts] = useState<DraftInteraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDrafts(await client.listDrafts());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load drafts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { drafts, loading, error, refresh };
}
