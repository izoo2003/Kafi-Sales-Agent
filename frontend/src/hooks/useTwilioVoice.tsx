import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Call, Device } from "@twilio/voice-sdk";
import { client, type CallInitiateResult } from "../api/client";

export interface PendingCallFollowUp {
  interactionId: number;
  label: string;
}

/** Identifies which dialed number currently owns the live call UI. */
export interface ActiveCallTarget {
  buyerId: number | null;
  contactId: number | null;
  phone: string | null;
}

interface TwilioVoiceContextValue {
  ready: boolean;
  active: boolean;
  activeCall: ActiveCallTarget | null;
  initError: string | null;
  pendingFollowUp: PendingCallFollowUp | null;
  clearPendingFollowUp: () => void;
  placeCall: (leadId: number, contactId?: number) => Promise<CallInitiateResult>;
  placeManualCall: (
    phone: string,
    options?: { contactName?: string; country?: string },
  ) => Promise<CallInitiateResult>;
  hangUp: () => void;
  retryInit: () => Promise<void>;
}

const TwilioVoiceContext = createContext<TwilioVoiceContextValue | null>(null);

function normalizePhoneDigits(phone: string | null | undefined): string {
  if (!phone) return "";
  return phone.replace(/\D/g, "");
}

/** True when two phone strings refer to the same dialed number. */
export function phonesMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const da = normalizePhoneDigits(a);
  const db = normalizePhoneDigits(b);
  if (!da || !db) return false;
  if (da === db) return true;
  // Match when one is a national form of the other (last 8–12 digits).
  const shorter = da.length <= db.length ? da : db;
  const longer = da.length <= db.length ? db : da;
  return shorter.length >= 8 && longer.endsWith(shorter);
}

export function TwilioVoiceProvider({ children }: { children: ReactNode }) {
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const activePrepRef = useRef<CallInitiateResult | null>(null);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(false);
  const [activeCall, setActiveCall] = useState<ActiveCallTarget | null>(null);
  const [initError, setInitError] = useState<string | null>(null);
  const [pendingFollowUp, setPendingFollowUp] = useState<PendingCallFollowUp | null>(null);

  const clearPendingFollowUp = useCallback(() => {
    setPendingFollowUp(null);
  }, []);

  const refreshToken = useCallback(async (device: Device) => {
    const { token } = await client.getVoiceToken();
    device.updateToken(token);
  }, []);

  const initDevice = useCallback(async () => {
    setInitError(null);
    const cfg = await client.getCallConfig();
    if (!cfg.browser_ready) {
      setReady(false);
      setInitError(cfg.setup_message ?? "Twilio browser calling is not configured");
      return;
    }

    const { token } = await client.getVoiceToken();
    const device = new Device(token, {
      codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
    });

    device.on("registered", () => {
      setReady(true);
      setInitError(null);
    });
    device.on("unregistered", () => setReady(false));
    device.on("error", (err) => {
      console.error("Twilio device error:", err);
      setInitError(err.message || "Twilio device error");
      setReady(false);
    });
    device.on("tokenWillExpire", () => {
      void refreshToken(device);
    });

    deviceRef.current?.destroy();
    deviceRef.current = device;
    await device.register();
    setReady(true);
  }, [refreshToken]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await initDevice();
      } catch (e) {
        if (!cancelled) {
          setReady(false);
          const message = e instanceof Error ? e.message : "Failed to initialize calling";
          // Don't treat one transient network blip as a permanent Twilio outage.
          if (/cannot reach the api|failed to fetch|network/i.test(message)) {
            setInitError("Calling is warming up — refresh in a few seconds if this persists.");
            window.setTimeout(() => {
              if (!cancelled) {
                void initDevice().catch(() => undefined);
              }
            }, 2500);
          } else {
            setInitError(message);
          }
        }
      }
    })();
    return () => {
      cancelled = true;
      callRef.current?.disconnect();
      deviceRef.current?.destroy();
      deviceRef.current = null;
      callRef.current = null;
    };
  }, [initDevice]);

  const retryInit = useCallback(async () => {
    try {
      await initDevice();
    } catch (e) {
      setReady(false);
      setInitError(e instanceof Error ? e.message : "Failed to initialize calling");
      throw e;
    }
  }, [initDevice]);

  const hangUp = useCallback(() => {
    callRef.current?.disconnect();
    callRef.current = null;
    setActive(false);
    setActiveCall(null);
  }, []);

  const connectPreparedCall = useCallback((activeDevice: Device, prep: CallInitiateResult) => {
    activePrepRef.current = prep;

    return activeDevice
      .connect({
        params: {
          To: prep.lead_phone!,
          interaction_id: String(prep.id),
        },
      })
      .then((call) => {
        callRef.current = call;
        setActive(true);
        setActiveCall({
          buyerId: prep.buyer_id ?? null,
          contactId: prep.contact_id ?? null,
          phone: prep.lead_phone ?? null,
        });

        const finishCall = () => {
          if (callRef.current === call) {
            callRef.current = null;
            setActive(false);
            setActiveCall(null);
          }
          const endedPrep = activePrepRef.current;
          activePrepRef.current = null;
          if (endedPrep) {
            setPendingFollowUp({
              interactionId: endedPrep.id,
              label:
                endedPrep.company_name ||
                endedPrep.contact_name ||
                endedPrep.subject?.replace(/^Call to /, "") ||
                "this call",
            });
          }
        };
        call.on("disconnect", finishCall);
        call.on("cancel", finishCall);

        return prep;
      });
  }, []);

  const placeCall = useCallback(
    async (leadId: number, contactId?: number) => {
      const device = deviceRef.current;
      if (!device) {
        await initDevice();
      }
      const activeDevice = deviceRef.current;
      if (!activeDevice) {
        throw new Error("Twilio calling is not ready. Check your Twilio setup in backend/.env");
      }

      const prep = await client.initiateLeadCall(leadId, { contact_id: contactId });
      if (!prep.lead_phone) {
        throw new Error("Lead phone number missing");
      }

      return connectPreparedCall(activeDevice, { ...prep, buyer_id: leadId });
    },
    [connectPreparedCall, initDevice],
  );

  const placeManualCall = useCallback(
    async (phone: string, options?: { contactName?: string; country?: string }) => {
      const device = deviceRef.current;
      if (!device) {
        await initDevice();
      }
      const activeDevice = deviceRef.current;
      if (!activeDevice) {
        throw new Error("Twilio calling is not ready. Check your Twilio setup in backend/.env");
      }

      const prep = await client.initiateManualCall({
        phone,
        contact_name: options?.contactName,
        country: options?.country,
      });
      if (!prep.lead_phone) {
        throw new Error("Phone number missing");
      }

      return connectPreparedCall(activeDevice, prep);
    },
    [connectPreparedCall, initDevice],
  );

  return (
    <TwilioVoiceContext.Provider
      value={{
        ready,
        active,
        activeCall,
        initError,
        pendingFollowUp,
        clearPendingFollowUp,
        placeCall,
        placeManualCall,
        hangUp,
        retryInit,
      }}
    >
      {children}
    </TwilioVoiceContext.Provider>
  );
}

export function useTwilioVoice(): TwilioVoiceContextValue {
  const ctx = useContext(TwilioVoiceContext);
  if (!ctx) {
    throw new Error("useTwilioVoice must be used within TwilioVoiceProvider");
  }
  return ctx;
}

/** Safe hook — returns null when provider is missing (e.g. tests). */
export function useTwilioVoiceOptional(): TwilioVoiceContextValue | null {
  return useContext(TwilioVoiceContext);
}
