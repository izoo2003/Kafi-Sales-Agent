/** Inbox alerts — popup, chime, optional voiceover, or fully off (user preference). */

export type NotificationMode = "popup_sound" | "popup_voiceover" | "off";

export interface InboxPopupPayload {
  id: string;
  from: string;
  subject: string;
  count: number;
}

export interface InterestedFollowUpPopupPayload {
  id: string;
  buyerId: number;
  companyName: string;
  contactName: string | null;
  dueAt: string;
  daysSincePlacement: number;
  tableSection?: "interested_clients" | "not_received_call_clients";
}

const MODE_STORAGE_KEY = "kafi.notificationMode";
const MODE_VALUES: NotificationMode[] = ["popup_sound", "popup_voiceover", "off"];

let audioCtx: AudioContext | null = null;
let audioUnlocked = false;
const popupListeners = new Set<(payload: InboxPopupPayload) => void>();
const followUpListeners = new Set<(payload: InterestedFollowUpPopupPayload) => void>();
const prefListeners = new Set<() => void>();

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

export function getNotificationMode(): NotificationMode {
  if (typeof window === "undefined") return "popup_sound";
  try {
    const raw = localStorage.getItem(MODE_STORAGE_KEY);
    if (raw && MODE_VALUES.includes(raw as NotificationMode)) {
      return raw as NotificationMode;
    }
  } catch {
    /* ignore */
  }
  return "popup_sound";
}

export function setNotificationMode(mode: NotificationMode) {
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode);
  } catch {
    /* ignore */
  }
  prefListeners.forEach((listener) => listener());
}

export function subscribeNotificationPrefs(listener: () => void) {
  prefListeners.add(listener);
  return () => prefListeners.delete(listener);
}

export function subscribeInboxPopup(listener: (payload: InboxPopupPayload) => void) {
  popupListeners.add(listener);
  return () => popupListeners.delete(listener);
}

export function subscribeInterestedFollowUpPopup(
  listener: (payload: InterestedFollowUpPopupPayload) => void,
) {
  followUpListeners.add(listener);
  return () => followUpListeners.delete(listener);
}

function emitInboxPopup(payload: InboxPopupPayload) {
  popupListeners.forEach((listener) => listener(payload));
}

function emitInterestedFollowUpPopup(payload: InterestedFollowUpPopupPayload) {
  followUpListeners.forEach((listener) => listener(payload));
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

/** Short alert chime — popup + sound only (no spoken dictation). */
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

function stopAnySpeech() {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

function speakAlert(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  try {
    stopAnySpeech();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.volume = 1;
    window.speechSynthesis.speak(utterance);
  } catch {
    /* ignore */
  }
}

function applyAlertEffects(mode: NotificationMode, spokenText: string) {
  if (mode === "off") return;
  unlockNotificationAudio();
  if (mode === "popup_sound") {
    stopAnySpeech();
    playNotificationChime();
  } else if (mode === "popup_voiceover") {
    speakAlert(spokenText);
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
  if (getNotificationMode() === "off") return;
  try {
    const notification = new Notification(title, {
      body,
      tag: "kafi-inbox",
      requireInteraction: true,
      silent: true, // we already play our own chime / voiceover
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
  const mode = getNotificationMode();
  if (mode === "off") return;

  const sender = details.from?.trim() || "a contact";
  const subject = details.subject?.trim() || "New message";
  const count = details.count ?? 1;

  const body =
    count > 1
      ? `${count} new emails waiting`
      : subject
        ? `${sender}: ${subject}`
        : `New email from ${sender}`;

  const spoken =
    count > 1
      ? `You have ${count} new inbox messages.`
      : `New inbox message from ${sender}. ${subject}.`;

  applyAlertEffects(mode, spoken);
  showDesktopNotification("New inbox message", body);

  emitInboxPopup({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    from: sender,
    subject,
    count,
  });
}

export function alertInterestedFollowUp(details: {
  id: string;
  buyerId: number;
  companyName: string;
  contactName?: string | null;
  dueAt: string;
  daysSincePlacement?: number;
  tableSection?: "interested_clients" | "not_received_call_clients";
}) {
  const mode = getNotificationMode();
  if (mode === "off") return;

  const label = details.contactName?.trim()
    ? `${details.contactName} (${details.companyName})`
    : details.companyName;
  const dueDate = new Date(details.dueAt);
  const dueLabel = Number.isNaN(dueDate.getTime())
    ? "today"
    : dueDate.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });

  applyAlertEffects(
    mode,
    `Follow up reminder. ${label}. Follow-up due ${dueLabel}.`,
  );

  showDesktopNotification(
    "Follow up client reminder",
    `${label} — follow-up due (${dueLabel})`,
  );

  emitInterestedFollowUpPopup({
    id: details.id,
    buyerId: details.buyerId,
    companyName: details.companyName,
    contactName: details.contactName ?? null,
    dueAt: details.dueAt,
    daysSincePlacement: details.daysSincePlacement ?? 0,
    tableSection: details.tableSection,
  });
}
