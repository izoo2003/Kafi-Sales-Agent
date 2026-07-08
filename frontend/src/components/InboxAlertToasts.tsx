import { useEffect, useState } from "react";
import {
  getNotificationPermission,
  requestNotificationPermission,
  subscribeInboxPopup,
  type InboxPopupPayload,
} from "../utils/notify";

interface InboxAlertToastsProps {
  onOpenInbox: () => void;
}

const AUTO_DISMISS_MS = 15_000;

export function InboxAlertToasts({ onOpenInbox }: InboxAlertToastsProps) {
  const [alerts, setAlerts] = useState<InboxPopupPayload[]>([]);
  const [notifPermission, setNotifPermission] = useState(getNotificationPermission());

  useEffect(() => {
    const timers = new Map<string, number>();

    const unsubscribe = subscribeInboxPopup((payload) => {
      setAlerts((prev) => [payload, ...prev].slice(0, 3));
      const timer = window.setTimeout(() => {
        setAlerts((prev) => prev.filter((item) => item.id !== payload.id));
        timers.delete(payload.id);
      }, AUTO_DISMISS_MS);
      timers.set(payload.id, timer);
    });

    return () => {
      unsubscribe();
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  function dismiss(id: string) {
    setAlerts((prev) => prev.filter((item) => item.id !== id));
  }

  async function enableDesktopNotifications() {
    const result = await requestNotificationPermission();
    setNotifPermission(result);
  }

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col items-end gap-3 max-w-sm w-[calc(100vw-2rem)] pointer-events-none">
      {notifPermission !== "granted" && notifPermission !== "unsupported" && (
        <div className="pointer-events-auto w-full rounded-xl border border-slate-700 bg-slate-900/95 backdrop-blur px-4 py-3 shadow-2xl text-sm">
          <p className="text-slate-200 font-medium">Enable desktop popups?</p>
          <p className="text-slate-400 text-xs mt-1">
            Get Windows/macOS notifications when new email arrives (even in another tab).
          </p>
          <button
            type="button"
            onClick={() => void enableDesktopNotifications()}
            className="mt-2 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
          >
            Allow notifications
          </button>
        </div>
      )}

      {alerts.map((alert) => (
        <div
          key={alert.id}
          role="alert"
          className="pointer-events-auto w-full rounded-xl border-2 border-emerald-500/80 bg-slate-950/95 backdrop-blur shadow-2xl shadow-emerald-900/30 animate-[slideIn_0.35s_ease-out]"
        >
          <div className="px-4 py-3 border-b border-emerald-500/20 flex items-start gap-3">
            <span className="mt-0.5 shrink-0 text-emerald-400 animate-pulse" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-5-1.6-1.6V10a5.4 5.4 0 0 0-4-5.23V4a1.4 1.4 0 0 0-2.8 0v.77A5.4 5.4 0 0 0 6.6 10v5.4L5 17a.9.9 0 0 0 .64 1.54h12.72A.9.9 0 0 0 19 17Z" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-emerald-300 text-xs font-semibold uppercase tracking-wide">
                {alert.count > 1 ? `${alert.count} new messages` : "New inbox message"}
              </p>
              <p className="text-slate-100 font-semibold truncate mt-0.5">{alert.from}</p>
              <p className="text-slate-400 text-sm truncate">{alert.subject}</p>
            </div>
            <button
              type="button"
              onClick={() => dismiss(alert.id)}
              className="shrink-0 text-slate-500 hover:text-slate-300 text-lg leading-none"
              aria-label="Dismiss"
            >
              ×
            </button>
          </div>
          <div className="px-4 py-2.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => dismiss(alert.id)}
              className="px-3 py-1.5 rounded-lg text-slate-400 hover:text-slate-200 text-xs"
            >
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => {
                dismiss(alert.id);
                onOpenInbox();
              }}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium"
            >
              Open inbox
            </button>
          </div>
        </div>
      ))}

      <style>{`
        @keyframes slideIn {
          from { opacity: 0; transform: translateX(1.5rem); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
