import { useCallback, useEffect, useState } from "react";
import { client, type CallConfig, type CallInitiateResult } from "../api/client";

interface CallLeadButtonProps {
  leadId: number;
  phone: string | null | undefined;
  contactId?: number;
  onError: (message: string) => void;
  onSuccess?: (result: CallInitiateResult) => void;
  compact?: boolean;
}

function normalizeTelHref(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) return `tel:${trimmed}`;
  return `tel:${trimmed.replace(/[^\d+]/g, "")}`;
}

export function CallLeadButton({
  leadId,
  phone,
  contactId,
  onError,
  onSuccess,
  compact = false,
}: CallLeadButtonProps) {
  const [config, setConfig] = useState<CallConfig | null>(null);
  const [calling, setCalling] = useState(false);
  const [agentPhone, setAgentPhone] = useState("");
  const [showAgentInput, setShowAgentInput] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      const cfg = await client.getCallConfig();
      setConfig(cfg);
      if (!cfg.has_default_agent_phone) {
        setShowAgentInput(true);
      }
    } catch {
      setConfig(null);
    }
  }, []);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  if (!phone?.trim()) {
    return null;
  }

  const canUseTwilio = config?.configured && config?.webhooks_ready;

  async function handleTwilioCall() {
    if (!canUseTwilio) return;
    const resolvedAgent = agentPhone.trim();
    if (!config?.has_default_agent_phone && !resolvedAgent) {
      onError("Enter your phone in international format (+92…, +1…) to receive the call.");
      setShowAgentInput(true);
      return;
    }

    setCalling(true);
    try {
      const result = await client.initiateLeadCall(leadId, {
        agent_phone: resolvedAgent || undefined,
        contact_id: contactId,
      });
      onSuccess?.(result);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Call failed");
    } finally {
      setCalling(false);
    }
  }

  const btnClass = compact
    ? "px-2 py-0.5 rounded text-xs bg-sky-600 hover:bg-sky-500 text-white disabled:opacity-50"
    : "px-3 py-1.5 rounded-lg text-sm bg-sky-600 hover:bg-sky-500 text-white font-medium disabled:opacity-50";

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
      {canUseTwilio ? (
        <>
          {showAgentInput && !config?.has_default_agent_phone && (
            <input
              type="tel"
              placeholder="+92… your mobile"
              value={agentPhone}
              onChange={(e) => setAgentPhone(e.target.value)}
              className="w-28 min-w-0 rounded bg-slate-950 border border-slate-700 px-2 py-0.5 text-xs text-slate-200"
              title="Your phone — Twilio rings you first, then connects the lead"
            />
          )}
          <button
            type="button"
            onClick={handleTwilioCall}
            disabled={calling}
            className={btnClass}
            title="Twilio rings your phone; answer to connect to the lead"
          >
            {calling ? "Calling…" : compact ? "Call" : "Call now"}
          </button>
        </>
      ) : (
        <a
          href={normalizeTelHref(phone)}
          className={btnClass + " inline-block text-center no-underline"}
          title={config?.configured ? "Set TWILIO_WEBHOOK_BASE_URL for in-app calling" : "Call via your phone"}
        >
          {compact ? "Call" : "Call"}
        </a>
      )}
    </span>
  );
}
