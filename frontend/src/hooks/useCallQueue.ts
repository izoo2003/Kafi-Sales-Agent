import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../api/client";
import { autocorrectText } from "../utils/spelling";
import { useTwilioVoice } from "./useTwilioVoice";

export const BATCH_SIZE = 10;
/** Brief pause before auto-advancing past a failed placeCall. */
export const GAP_SECONDS = 3;

export type QueueStatus = "idle" | "running" | "between" | "paused" | "completed";

export interface QueueEntry {
  leadId: number;
  contactId?: number;
  companyName: string;
  contactName?: string | null;
  phone: string;
  country?: string | null;
}

export interface QueueResult {
  leadId: number;
  companyName: string;
  interactionId?: number;
  callStatus?: string | null;
  outcome?: string | null;
  notes?: string;
  skipped?: boolean;
  error?: string;
}

export interface CallQueueState {
  queue: QueueEntry[];
  currentIndex: number;
  status: QueueStatus;
  results: QueueResult[];
  /** Countdown only used for failed placeCall auto-advance; null during remarks gap. */
  gapSecondsLeft: number | null;
  batchNumber: number;
  totalBatches: number;
  indexInBatch: number;
  batchSize: number;
  /** Outcome/notes for the call that just ended — settable during the gap. */
  pendingOutcome: string | null;
  pendingNotes: string;
  savingRemarks: boolean;
  setPendingOutcome: (v: string | null) => void;
  setPendingNotes: (v: string) => void;
  /** Persist remarks for the finished call, then dial the next lead. */
  savePendingAndContinue: () => Promise<void>;
  start: (leads: QueueEntry[]) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  skipCurrent: () => void;
}

export function useCallQueue(): CallQueueState {
  const { placeCall, hangUp, pendingFollowUp, clearPendingFollowUp, setBulkModeActive } =
    useTwilioVoice();

  const [queue, setQueue] = useState<QueueEntry[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [status, setStatus] = useState<QueueStatus>("idle");
  const [results, setResults] = useState<QueueResult[]>([]);
  const [gapSecondsLeft, setGapSecondsLeft] = useState<number | null>(null);
  const [pendingOutcome, setPendingOutcome] = useState<string | null>(null);
  const [pendingNotes, setPendingNotes] = useState("");
  const [savingRemarks, setSavingRemarks] = useState(false);

  const statusRef = useRef<QueueStatus>("idle");
  const currentIndexRef = useRef(0);
  const gapTimerRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);
  const pendingInteractionIdRef = useRef<number | undefined>(undefined);
  const pendingOutcomeRef = useRef<string | null>(null);
  const pendingNotesRef = useRef("");

  const clearTimers = () => {
    if (gapTimerRef.current !== null) {
      window.clearTimeout(gapTimerRef.current);
      gapTimerRef.current = null;
    }
    if (countdownRef.current !== null) {
      window.clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
  };

  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);
  const setPendingOutcomeSafe = useCallback((v: string | null) => {
    pendingOutcomeRef.current = v;
    setPendingOutcome(v);
  }, []);
  const setPendingNotesSafe = useCallback((v: string) => {
    pendingNotesRef.current = v;
    setPendingNotes(v);
  }, []);

  const batchNumber = Math.floor(currentIndex / BATCH_SIZE) + 1;
  const totalBatches = Math.ceil(queue.length / BATCH_SIZE);
  const indexInBatch = currentIndex % BATCH_SIZE;

  const flushPendingRemarks = useCallback(
    async (interactionId: number | undefined, outcome: string | null, notes: string) => {
      if (!interactionId) return;
      try {
        await client.updateCallFollowUp(interactionId, {
          notes,
          call_outcome: outcome || null,
        });
      } catch {
        // Non-blocking — remarks can be edited later in call history
      }
    },
    [],
  );

  const advanceToNext = useCallback(
    (fromIndex: number, queueSnapshot: QueueEntry[]) => {
      const nextIndex = fromIndex + 1;
      if (nextIndex >= queueSnapshot.length) {
        setStatus("completed");
        statusRef.current = "completed";
        setCurrentIndex(nextIndex);
        currentIndexRef.current = nextIndex;
        setGapSecondsLeft(null);
        setBulkModeActive(false);
        return;
      }
      setCurrentIndex(nextIndex);
      currentIndexRef.current = nextIndex;
      setStatus("running");
      statusRef.current = "running";
      setGapSecondsLeft(null);

      const next = queueSnapshot[nextIndex];
      placeCall(next.leadId, next.contactId).catch((err) => {
        setResults((prev) =>
          prev.map((r, i) =>
            i === nextIndex
              ? { ...r, error: err instanceof Error ? err.message : "Call failed" }
              : r,
          ),
        );
        gapTimerRef.current = window.setTimeout(() => {
          if (statusRef.current === "running") {
            advanceToNext(nextIndex, queueSnapshot);
          }
        }, GAP_SECONDS * 1000);
      });
    },
    [placeCall, setBulkModeActive],
  );

  // After a call ends, wait for Save & next (or Skip) — do not auto-advance.
  useEffect(() => {
    if (!pendingFollowUp || statusRef.current === "idle" || statusRef.current === "completed") {
      return;
    }

    const interactionId = pendingFollowUp.interactionId;
    const idx = currentIndexRef.current;

    setResults((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, interactionId } : r)),
    );

    clearPendingFollowUp();

    if (statusRef.current === "paused") {
      pendingInteractionIdRef.current = interactionId;
      return;
    }

    clearTimers();
    pendingInteractionIdRef.current = interactionId;
    setPendingOutcomeSafe(null);
    setPendingNotesSafe("");
    setStatus("between");
    statusRef.current = "between";
    setGapSecondsLeft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFollowUp]);

  const savePendingAndContinue = useCallback(async () => {
    if (statusRef.current !== "between" && statusRef.current !== "paused") return;
    if (savingRemarks) return;

    const interactionId = pendingInteractionIdRef.current;
    const outcome = pendingOutcomeRef.current;
    const notes = autocorrectText(pendingNotesRef.current, "prose");
    const idx = currentIndexRef.current;

    setSavingRemarks(true);
    try {
      await flushPendingRemarks(interactionId, outcome, notes);
      setResults((prev) =>
        prev.map((r, i) =>
          i === idx
            ? {
                ...r,
                interactionId: interactionId ?? r.interactionId,
                outcome: outcome || r.outcome,
                notes: notes || r.notes,
              }
            : r,
        ),
      );
    } finally {
      setSavingRemarks(false);
    }

    pendingInteractionIdRef.current = undefined;
    setPendingOutcomeSafe(null);
    setPendingNotesSafe("");
    setGapSecondsLeft(null);

    setQueue((currentQueue) => {
      advanceToNext(idx, currentQueue);
      return currentQueue;
    });
  }, [
    advanceToNext,
    flushPendingRemarks,
    savingRemarks,
    setPendingNotesSafe,
    setPendingOutcomeSafe,
  ]);

  const start = useCallback(
    (leads: QueueEntry[]) => {
      if (!leads.length) return;
      clearTimers();
      const initialResults: QueueResult[] = leads.map((l) => ({
        leadId: l.leadId,
        companyName: l.companyName,
      }));
      setQueue(leads);
      setResults(initialResults);
      setCurrentIndex(0);
      currentIndexRef.current = 0;
      setStatus("running");
      statusRef.current = "running";
      setGapSecondsLeft(null);
      setPendingOutcomeSafe(null);
      setPendingNotesSafe("");
      pendingInteractionIdRef.current = undefined;
      setSavingRemarks(false);
      setBulkModeActive(true);

      const first = leads[0];
      placeCall(first.leadId, first.contactId).catch((err) => {
        setResults((prev) =>
          prev.map((r, i) =>
            i === 0
              ? { ...r, error: err instanceof Error ? err.message : "Call failed" }
              : r,
          ),
        );
        gapTimerRef.current = window.setTimeout(() => {
          advanceToNext(0, leads);
        }, GAP_SECONDS * 1000);
      });
    },
    [placeCall, advanceToNext, setBulkModeActive, setPendingNotesSafe, setPendingOutcomeSafe],
  );

  const pause = useCallback(() => {
    clearTimers();
    setStatus("paused");
    statusRef.current = "paused";
    setGapSecondsLeft(null);
    hangUp();
  }, [hangUp]);

  const resume = useCallback(() => {
    if (statusRef.current !== "paused") return;
    // If a call already ended while paused, show remarks before dialing next.
    if (pendingInteractionIdRef.current != null) {
      setStatus("between");
      statusRef.current = "between";
      return;
    }
    setStatus("running");
    statusRef.current = "running";
    setQueue((currentQueue) => {
      const idx = currentIndexRef.current;
      if (idx < currentQueue.length) {
        const entry = currentQueue[idx];
        placeCall(entry.leadId, entry.contactId).catch(() => {
          advanceToNext(idx, currentQueue);
        });
      }
      return currentQueue;
    });
  }, [placeCall, advanceToNext]);

  const stop = useCallback(() => {
    clearTimers();
    hangUp();
    clearPendingFollowUp();
    setStatus("idle");
    statusRef.current = "idle";
    setQueue([]);
    setResults([]);
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setGapSecondsLeft(null);
    setPendingOutcomeSafe(null);
    setPendingNotesSafe("");
    pendingInteractionIdRef.current = undefined;
    setSavingRemarks(false);
    setBulkModeActive(false);
  }, [
    hangUp,
    clearPendingFollowUp,
    setBulkModeActive,
    setPendingNotesSafe,
    setPendingOutcomeSafe,
  ]);

  const skipCurrent = useCallback(() => {
    clearTimers();
    hangUp();
    const idx = currentIndexRef.current;
    // Mid-call skip marks the lead skipped; skipping the remarks gap just advances.
    if (statusRef.current === "running") {
      setResults((prev) =>
        prev.map((r, i) => (i === idx ? { ...r, skipped: true } : r)),
      );
    }
    pendingInteractionIdRef.current = undefined;
    setPendingOutcomeSafe(null);
    setPendingNotesSafe("");
    setQueue((currentQueue) => {
      advanceToNext(idx, currentQueue);
      return currentQueue;
    });
  }, [hangUp, advanceToNext, setPendingNotesSafe, setPendingOutcomeSafe]);

  return {
    queue,
    currentIndex,
    status,
    results,
    gapSecondsLeft,
    batchNumber,
    totalBatches,
    indexInBatch,
    batchSize: BATCH_SIZE,
    pendingOutcome,
    pendingNotes,
    savingRemarks,
    setPendingOutcome: setPendingOutcomeSafe,
    setPendingNotes: setPendingNotesSafe,
    savePendingAndContinue,
    start,
    pause,
    resume,
    stop,
    skipCurrent,
  };
}
