"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { redeemSessionCode } from "@/lib/api";
import { useAuth } from "@/components/AuthProvider";

function CallbackInner() {
  const params = useSearchParams();
  const router = useRouter();
  const { refresh } = useAuth();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = params.get("code");
    if (!code) {
      setError("Missing session code");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        await redeemSessionCode(code);
        await refresh();
        if (!cancelled) router.replace("/inbox");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not open mail session");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params, refresh, router]);

  return (
    <div className="wrap">
      <div className="card">
        <h1>Kafi Mail</h1>
        {error ? (
          <>
            <p className="bad">{error}</p>
            <button type="button" className="btn" onClick={() => router.replace("/login")}>
              Go to login
            </button>
          </>
        ) : (
          <p className="muted">Opening your mailbox…</p>
        )}
      </div>
    </div>
  );
}

export default function AuthCallbackPage() {
  return (
    <Suspense fallback={<div className="wrap muted">Loading…</div>}>
      <CallbackInner />
    </Suspense>
  );
}
