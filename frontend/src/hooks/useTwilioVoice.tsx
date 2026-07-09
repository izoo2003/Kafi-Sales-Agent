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

interface TwilioVoiceContextValue {
  ready: boolean;
  active: boolean;
  placeCall: (leadId: number, contactId?: number) => Promise<CallInitiateResult>;
  hangUp: () => void;
}

const TwilioVoiceContext = createContext<TwilioVoiceContextValue | null>(null);

export function TwilioVoiceProvider({ children }: { children: ReactNode }) {
  const deviceRef = useRef<Device | null>(null);
  const callRef = useRef<Call | null>(null);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(false);

  const refreshToken = useCallback(async (device: Device) => {
    const { token } = await client.getVoiceToken();
    device.updateToken(token);
  }, []);

  const initDevice = useCallback(async () => {
    const cfg = await client.getCallConfig();
    if (!cfg.browser_ready) {
      setReady(false);
      return;
    }

    const { token } = await client.getVoiceToken();
    const device = new Device(token, {
      codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
    });

    device.on("registered", () => setReady(true));
    device.on("unregistered", () => setReady(false));
    device.on("error", (err) => console.error("Twilio device error:", err));
    device.on("tokenWillExpire", () => {
      void refreshToken(device);
    });

    await device.register();
    deviceRef.current = device;
    setReady(true);
  }, [refreshToken]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await initDevice();
      } catch {
        if (!cancelled) setReady(false);
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

  const hangUp = useCallback(() => {
    callRef.current?.disconnect();
    callRef.current = null;
    setActive(false);
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

      const call = await activeDevice.connect({
        params: {
          To: prep.lead_phone,
          interaction_id: String(prep.id),
        },
      });

      callRef.current = call;
      setActive(true);

      const cleanup = () => {
        if (callRef.current === call) {
          callRef.current = null;
          setActive(false);
        }
      };
      call.on("disconnect", cleanup);
      call.on("cancel", cleanup);

      return prep;
    },
    [initDevice],
  );

  return (
    <TwilioVoiceContext.Provider value={{ ready, active, placeCall, hangUp }}>
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
