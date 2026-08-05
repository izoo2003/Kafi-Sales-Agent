import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../api/client";
import { autocorrectText } from "../utils/spelling";
import { useTwilioVoice } from "./useTwilioVoice";

export const BATCH_SIZE = 10;
/** Brief wait for hang-up follow-up to attach an interaction id. */
const HANGUP_SETTLE_MS = 400;

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
  gapSecondsLeft: number | null;
  batchNumber: number;
  totalBatches: number;
  indexInBatch: number;
  batchSize: number;
  /** Outcome/notes for the current call — editable while dialing and after hang-up. */
  pendingOutcome: string | null;
  pendingNotes: string;
  savingRemarks: boolean;
  setPendingOutcome: (v: string | null) => void;
  setPendingNotes: (v: string) => void;
  /** Save remarks for the current call, hang up if needed, then dial the next lead. */
  savePendingAndContinue: () => Promise<void>;
  start: (leads: QueueEntry[]) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  skipCurrent: () => void;
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
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
  const pendingInteractionIdRef = useRef<number | undefined>(undefined);
  const pendingOutcomeRef = useRef<string | null>(null);
  const pendingNotesRef = useRef("");
  /** When true, call-end follow-up only records interactionId (no between transition / note wipe). */
  const suppressBetweenRef = useRef(false);

  const clearTimers = () => {
    if (gapTimerRef.current !== null) {
      window.clearTimeout(gapTimerRef.current);
      gapTimerRef.current = null;
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

  const resetRemarksForNextCall = useCallback(() => {
    pendingInteractionIdRef.current = undefined;
    setPendingOutcomeSafe(null);
    setPendingNotesSafe("");
  }, [setPendingNotesSafe, setPendingOutcomeSafe]);

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

  const bindInteraction = useCallback((index: number, interactionId: number) => {
    pendingInteractionIdRef.current = interactionId;
    setResults((prev) =>
      prev.map((r, i) => (i === index ? { ...r, interactionId } : r)),
    );
  }, []);

  const dialEntry = useCallback(
    (index: number, queueSnapshot: QueueEntry[]) => {
      const entry = queueSnapshot[index];
      if (!entry) return;

      placeCall(entry.leadId, entry.contactId)
        .then((prep) => {
          if (currentIndexRef.current !== index) return;
          if (prep?.id != null) {
            bindInteraction(index, prep.id);
          }
        })
        .catch((err) => {
          if (currentIndexRef.current !== index) return;
          setResults((prev) =>
            prev.map((r, i) =>
              i === index
                ? { ...r, error: err instanceof Error ? err.message : "Call failed" }
                : r,
            ),
          );
          // Stay on this lead so the user can still Save & next (or Skip).
          setStatus("between");
          statusRef.current = "between";
        });
    },
    [bindInteraction, placeCall],
  );

  const advanceToNext = useCallback(
    (fromIndex: number, queueSnapshot: QueueEntry[]) => {
      const nextIndex = fromIndex + 1;
      resetRemarksForNextCall();

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
      dialEntry(nextIndex, queueSnapshot);
    },
    [dialEntry, resetRemarksForNextCall, setBulkModeActive],
  );

  // Call ended naturally — keep typed remarks; wait for Save & next.
  useEffect(() => {
    if (!pendingFollowUp || statusRef.current === "idle" || statusRef.current === "completed") {
      return;
    }

    const interactionId = pendingFollowUp.interactionId;
    const idx = currentIndexRef.current;
    bindInteraction(idx, interactionId);
    clearPendingFollowUp();

    if (suppressBetweenRef.current) {
      return;
    }

    if (statusRef.current === "paused") {
      return;
    }

    clearTimers();
    // Preserve notes typed during the call — do not wipe pendingOutcome/notes.
    setStatus("between");
    statusRef.current = "between";
    setGapSecondsLeft(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFollowUp]);

  const savePendingAndContinue = useCallback(async () => {
    if (
      statusRef.current !== "running" &&
      statusRef.current !== "between" &&
      statusRef.current !== "paused"
    ) {
      return;
    }
    if (savingRemarks) return;

    const outcome = pendingOutcomeRef.current;
    const notes = autocorrectText(pendingNotesRef.current, "prose");
    const idx = currentIndexRef.current;

    setSavingRemarks(true);
    suppressBetweenRef.current = true;
    clearTimers();

    try {
      // End the active call if still connected; settle so interaction id is available.
      hangUp();
      await sleep(HANGUP_SETTLE_MS);

      const interactionId = pendingInteractionIdRef.current;
      await flushPendingRemarks(interactionId, outcome, notes);

      setResults((prev) =>
        prev.map((r, i) =>
          i === idx
            ? {
                ...r,
                interactionId: interactionId ?? r.interactionId,
                outcome: outcome || r.outcome,
                notes: notes || r.notes,
                skipped: false,
              }
            : r,
        ),
      );

      clearPendingFollowUp();

      setQueue((currentQueue) => {
        advanceToNext(idx, currentQueue);
        return currentQueue;
      });
    } finally {
      suppressBetweenRef.current = false;
      setSavingRemarks(false);
    }
  }, [
    advanceToNext,
    clearPendingFollowUp,
    flushPendingRemarks,
    hangUp,
    savingRemarks,
  ]);

  const start = useCallback(
    (leads: QueueEntry[]) => {
      if (!leads.length) return;
      clearTimers();
      suppressBetweenRef.current = false;
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
      resetRemarksForNextCall();
      setSavingRemarks(false);
      setBulkModeActive(true);
      dialEntry(0, leads);
    },
    [dialEntry, resetRemarksForNextCall, setBulkModeActive],
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
    // Call already ended (or failed) while paused — resume into remarks, not a re-dial.
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
        dialEntry(idx, currentQueue);
      }
      return currentQueue;
    });
  }, [dialEntry]);

  const stop = useCallback(() => {
    clearTimers();
    suppressBetweenRef.current = false;
    hangUp();
    clearPendingFollowUp();
    setStatus("idle");
    statusRef.current = "idle";
    setQueue([]);
    setResults([]);
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setGapSecondsLeft(null);
    resetRemarksForNextCall();
    setSavingRemarks(false);
    setBulkModeActive(false);
  }, [
    hangUp,
    clearPendingFollowUp,
    setBulkModeActive,
    resetRemarksForNextCall,
  ]);

  const skipCurrent = useCallback(() => {
    clearTimers();
    suppressBetweenRef.current = true;
    hangUp();
    const idx = currentIndexRef.current;
    setResults((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, skipped: true } : r)),
    );
    clearPendingFollowUp();
    window.setTimeout(() => {
      suppressBetweenRef.current = false;
    }, HANGUP_SETTLE_MS);
    setQueue((currentQueue) => {
      advanceToNext(idx, currentQueue);
      return currentQueue;
    });
  }, [hangUp, advanceToNext, clearPendingFollowUp]);

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
