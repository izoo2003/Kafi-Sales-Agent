/** Inbox alerts — sound, voice, desktop notification, and in-app popup. */

export interface InboxPopupPayload {
  id: string;
  from: string;
  subject: string;
  count: number;
}

let audioCtx: AudioContext | null = null;
let audioUnlocked = false;
const popupListeners = new Set<(payload: InboxPopupPayload) => void>();

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

export function subscribeInboxPopup(listener: (payload: InboxPopupPayload) => void) {
  popupListeners.add(listener);
  return () => popupListeners.delete(listener);
}

function emitInboxPopup(payload: InboxPopupPayload) {
  popupListeners.forEach((listener) => listener(payload));
}

/** Call once after a user click/keypress so browsers allow sound. */
export function unlockNotificationAudio() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();
  if (audioUnlocked) return;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  gain.gain.value = 0.0001;
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + 0.01);
  audioUnlocked = true;
}

function playTone(
  ctx: AudioContext,
  freq: number,
  start: number,
  duration: number,
  volume: number,
  type: OscillatorType = "square",
) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const end = start + duration;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
  osc.connect(gain).connect(ctx.destination);
  osc.start(start);
  osc.stop(end + 0.02);
}

/** Loud repeating alarm — hard to miss. */
export function playNotificationChime() {
  const ctx = getAudioContext();
  if (!ctx) return;
  if (ctx.state === "suspended") void ctx.resume();

  const now = ctx.currentTime;
  const pattern = [
    { freq: 880, start: 0, duration: 0.22 },
    { freq: 1174.66, start: 0.28, duration: 0.22 },
    { freq: 880, start: 0.56, duration: 0.22 },
    { freq: 1174.66, start: 0.84, duration: 0.35 },
    { freq: 1318.51, start: 1.3, duration: 0.45 },
  ];

  for (const tone of pattern) {
    playTone(ctx, tone.freq, now + tone.start, tone.duration, 0.75, "square");
  }
}

export function speakInboxAlert(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.volume = 1;
    utterance.rate = 0.95;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  } catch {
    /* ignore */
  }
}

export function getNotificationPermission(): NotificationPermission | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "default") {
    return Notification.requestPermission();
  }
  return Notification.permission;
}

export function showDesktopNotification(title: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  try {
    const notification = new Notification(title, {
      body,
      tag: "kafi-inbox",
      requireInteraction: true,
    });
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    /* ignore */
  }
}

export function alertNewInboxMessage(details: {
  from?: string | null;
  subject?: string | null;
  count?: number;
}) {
  unlockNotificationAudio();
  playNotificationChime();

  const sender = details.from?.trim() || "a contact";
  const subject = details.subject?.trim() || "New message";
  const count = details.count ?? 1;
  const spoken =
    count > 1
      ? `Attention! You have ${count} new messages in your sales inbox.`
      : subject
        ? `Attention! New email from ${sender}. Subject: ${subject}`
        : `Attention! New email received from ${sender}.`;

  window.setTimeout(() => speakInboxAlert(spoken), 350);

  const body =
    count > 1
      ? `${count} new emails waiting`
      : subject
        ? `${sender}: ${subject}`
        : `New email from ${sender}`;

  showDesktopNotification("New inbox message", body);

  emitInboxPopup({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    from: sender,
    subject,
    count,
  });
}
