import { useCallback, useEffect, useRef, useState } from "react";
import { client } from "../api/client";
import { useTwilioVoice } from "./useTwilioVoice";

export const BATCH_SIZE = 10;
export const GAP_SECONDS = 3;

export type QueueStatus = "idle" | "running" | "between" | "paused" | "completed";

export interface QueueEntry {
  leadId: number;
  contactId?: number;
  companyName: string;
  contactName?: string | null;
  phone: string;
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
  /** Countdown seconds remaining in the gap between calls (null when not in gap). */
  gapSecondsLeft: number | null;
  batchNumber: number;
  totalBatches: number;
  indexInBatch: number;
  batchSize: number;
  /** Outcome/notes for the call that just ended — settable during the gap. */
  pendingOutcome: string | null;
  pendingNotes: string;
  setPendingOutcome: (v: string | null) => void;
  setPendingNotes: (v: string) => void;
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

  const statusRef = useRef<QueueStatus>("idle");
  const currentIndexRef = useRef(0);
  const gapTimerRef = useRef<number | null>(null);
  const countdownRef = useRef<number | null>(null);

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

  // Keep refs in sync with state
  useEffect(() => {
    statusRef.current = status;
  }, [status]);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  // Derived batch info
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
        // Auto-advance past failed call after 3s
        gapTimerRef.current = window.setTimeout(() => {
          if (statusRef.current === "running") {
            advanceToNext(nextIndex, queueSnapshot);
          }
        }, GAP_SECONDS * 1000);
      });
    },
    [placeCall, setBulkModeActive],
  );

  // React to call ending (pendingFollowUp fires from voice provider)
  useEffect(() => {
    if (!pendingFollowUp || statusRef.current === "idle" || statusRef.current === "completed") {
      return;
    }

    const interactionId = pendingFollowUp.interactionId;
    const idx = currentIndexRef.current;

    // Capture the interactionId into results
    setResults((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, interactionId } : r)),
    );

    // Suppress the global modal
    clearPendingFollowUp();

    if (statusRef.current === "paused") {
      // Stay paused; user will resume manually
      return;
    }

    // Start the gap countdown
    setStatus("between");
    statusRef.current = "between";
    setGapSecondsLeft(GAP_SECONDS);

    let remaining = GAP_SECONDS;
    countdownRef.current = window.setInterval(() => {
      remaining -= 1;
      setGapSecondsLeft(remaining);
      if (remaining <= 0) {
        clearTimers();
      }
    }, 1000);

    // Capture current pending values via closure — they may change during the gap
    const outcomeAtEnd = pendingOutcome;
    const notesAtEnd = pendingNotes;

    gapTimerRef.current = window.setTimeout(() => {
      clearTimers();
      // Flush remarks with whatever the user had at fire time
      void flushPendingRemarks(interactionId, outcomeAtEnd, notesAtEnd);
      setPendingOutcome(null);
      setPendingNotes("");

      // Grab a fresh snapshot of queue state
      setQueue((currentQueue) => {
        if (statusRef.current !== "between") return currentQueue;
        advanceToNext(idx, currentQueue);
        return currentQueue;
      });
    }, GAP_SECONDS * 1000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFollowUp]);

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
      setPendingOutcome(null);
      setPendingNotes("");
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
    [placeCall, advanceToNext, setBulkModeActive],
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
    setPendingOutcome(null);
    setPendingNotes("");
    setBulkModeActive(false);
  }, [hangUp, clearPendingFollowUp, setBulkModeActive]);

  const skipCurrent = useCallback(() => {
    clearTimers();
    hangUp();
    const idx = currentIndexRef.current;
    setResults((prev) =>
      prev.map((r, i) => (i === idx ? { ...r, skipped: true } : r)),
    );
    setQueue((currentQueue) => {
      advanceToNext(idx, currentQueue);
      return currentQueue;
    });
  }, [hangUp, advanceToNext]);

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
    setPendingOutcome,
    setPendingNotes,
    start,
    pause,
    resume,
    stop,
    skipCurrent,
  };
}
