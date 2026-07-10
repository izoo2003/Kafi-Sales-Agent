import { useCallback, useEffect, useState } from "react";
import { client, type CallConfig, type CallInitiateResult } from "../api/client";
import { useTwilioVoiceOptional } from "../hooks/useTwilioVoice";

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
  const voice = useTwilioVoiceOptional();
  const [config, setConfig] = useState<CallConfig | null>(null);
  const [calling, setCalling] = useState(false);

  const loadConfig = useCallback(async () => {
    try {
      setConfig(await client.getCallConfig());
    } catch {
      setConfig(null);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  if (!phone?.trim()) {
    return null;
  }

  const canUseTwilio = Boolean(config?.browser_ready && voice);
  const callBlockedReason =
    voice?.initError ??
    config?.setup_message ??
    (!voice?.ready ? "Initializing calling…" : null);

  async function handleTwilioCall() {
    if (!canUseTwilio || !voice) return;
    if (!voice.ready) {
      try {
        await voice.retryInit();
      } catch (e) {
        onError(e instanceof Error ? e.message : "Calling is not ready yet");
        return;
      }
    }

    setCalling(true);
    try {
      const result = await voice.placeCall(leadId, contactId);
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

  const inCall = voice?.active ?? false;
  const showInitError = canUseTwilio && voice && !voice.ready && voice.initError;

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
      {showInitError && !compact && (
        <span className="text-xs text-red-300" title={voice.initError ?? undefined}>
          Calling unavailable
        </span>
      )}
      {canUseTwilio ? (
        <>
          <button
            type="button"
            onClick={handleTwilioCall}
            disabled={calling || inCall || !voice.ready}
            className={btnClass}
            title={
              voice.ready
                ? "Call client directly from your browser (allow microphone)"
                : callBlockedReason ?? "Calling is not ready yet"
            }
          >
            {calling ? "Connecting…" : inCall ? "On call" : compact ? "Call" : "Call now"}
          </button>
          {inCall && (
            <button
              type="button"
              onClick={() => voice.hangUp()}
              className={
                compact
                  ? "px-2 py-0.5 rounded text-xs bg-red-600 hover:bg-red-500 text-white"
                  : "px-2 py-1 rounded-lg text-xs bg-red-600 hover:bg-red-500 text-white"
              }
            >
              End
            </button>
          )}
        </>
      ) : (
        <a
          href={normalizeTelHref(phone)}
          className={btnClass + " inline-block text-center no-underline"}
          title={
            config?.configured
              ? "Complete Twilio browser setup (API key + TwiML App) for in-app calling"
              : "Call via your phone"
          }
        >
          {compact ? "Call" : "Call"}
        </a>
      )}
    </span>
  );
}
