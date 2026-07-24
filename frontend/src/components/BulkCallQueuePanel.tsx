import { useEffect, useState } from "react";
import { type CallQueueState, BATCH_SIZE, GAP_SECONDS } from "../hooks/useCallQueue";
import { CALL_OUTCOMES } from "../utils/callOutcomes";
import { CallingCard } from "./CallingCard";

interface BulkCallQueuePanelProps {
  queue: CallQueueState;
  onClose: () => void;
}

function statusDot(
  index: number,
  currentIndex: number,
  status: CallQueueState["status"],
  results: CallQueueState["results"],
) {
  const result = results[index];
  if (result?.skipped)
    return (
      <span className="w-2 h-2 rounded-full bg-amber-500/70 shrink-0" title="Skipped" />
    );
  if (result?.error)
    return <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" title={result.error} />;
  if (result?.callStatus === "completed")
    return <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="Completed" />;
  if (result?.callStatus && result.callStatus !== "completed" && result.callStatus !== "in-progress")
    return (
      <span
        className="w-2 h-2 rounded-full bg-red-400/70 shrink-0"
        title={result.callStatus ?? "Ended"}
      />
    );
  if (index === currentIndex) {
    if (status === "running")
      return (
        <span
          className="w-2 h-2 rounded-full bg-sky-400 shrink-0 animate-pulse"
          title="Calling…"
        />
      );
    if (status === "between")
      return (
        <span
          className="w-2 h-2 rounded-full bg-amber-400 shrink-0 animate-pulse"
          title="Gap"
        />
      );
    return <span className="w-2 h-2 rounded-full bg-slate-500 shrink-0" />;
  }
  if (index < currentIndex)
    return (
      <span className="w-2 h-2 rounded-full bg-slate-600 shrink-0" title="Done" />
    );
  return <span className="w-2 h-2 rounded-full border border-slate-600 shrink-0" title="Queued" />;
}

export function BulkCallQueuePanel({ queue, onClose }: BulkCallQueuePanelProps) {
  const {
    status,
    currentIndex,
    results,
    gapSecondsLeft,
    batchNumber,
    totalBatches,
    indexInBatch,
    pendingOutcome,
    pendingNotes,
    setPendingOutcome,
    setPendingNotes,
    pause,
    resume,
    stop,
    skipCurrent,
    queue: entries,
  } = queue;

  const currentEntry = entries[currentIndex] ?? null;
  const [dismissedLeadId, setDismissedLeadId] = useState<number | null>(null);

  // Reset dismiss when the active company changes (skip / next).
  useEffect(() => {
    setDismissedLeadId(null);
  }, [currentEntry?.leadId]);

  if (status === "idle") return null;

  const totalCalls = entries.length;
  const completedCount = results.filter(
    (r) => r.callStatus || r.skipped || r.error,
  ).length;
  const progressPct = totalCalls > 0 ? Math.round((completedCount / totalCalls) * 100) : 0;

  const currentResult = results[currentIndex] ?? null;
  const showCallingCard =
    Boolean(currentEntry) &&
    (status === "running" || status === "between" || status === "paused") &&
    dismissedLeadId !== currentEntry?.leadId;

  // Batch slice for the list
  const batchStart = (batchNumber - 1) * BATCH_SIZE;
  const batchEnd = Math.min(batchStart + BATCH_SIZE, totalCalls);
  const batchEntries = entries.slice(batchStart, batchEnd);

  return (
    <>
    {showCallingCard && currentEntry && (
      <div className="fixed bottom-4 right-4 z-[60] w-[min(100vw-2rem,22rem)] pointer-events-auto">
        <CallingCard
          leadId={currentEntry.leadId}
          fallback={{
            companyName: currentEntry.companyName,
            contactName: currentEntry.contactName,
            country: currentEntry.country,
            phone: currentEntry.phone,
          }}
          onDismiss={() => setDismissedLeadId(currentEntry.leadId)}
        />
      </div>
    )}
    <div className="rounded-xl border border-sky-800/50 bg-slate-900 overflow-hidden shadow-xl">
      {/* Header */}
      <div className="px-4 py-3 bg-sky-950/60 border-b border-sky-800/40 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {status === "running" && (
            <span className="w-2.5 h-2.5 rounded-full bg-sky-400 animate-pulse shrink-0" />
          )}
          {status === "between" && (
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
          )}
          {status === "paused" && (
            <span className="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0" />
          )}
          {status === "completed" && (
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-100 truncate">
              {status === "completed"
                ? `Bulk call finished · ${totalCalls} calls`
                : status === "paused"
                  ? "Bulk call paused"
                  : status === "between"
                    ? `Next call in ${gapSecondsLeft ?? GAP_SECONDS}s…`
                    : `Calling ${currentEntry?.companyName ?? "…"}`}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {totalBatches > 1
                ? `Batch ${batchNumber} / ${totalBatches} · `
                : ""}
              {Math.min(completedCount + 1, totalCalls)} / {totalCalls} calls
              {totalBatches > 1 ? ` · #${indexInBatch + 1} in batch` : ""}
            </p>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {status === "running" && (
            <button
              type="button"
              onClick={skipCurrent}
              className="px-2.5 py-1.5 rounded-lg bg-amber-900/50 hover:bg-amber-900/70 border border-amber-700/40 text-amber-200 text-xs"
            >
              Skip
            </button>
          )}
          {status === "between" && (
            <button
              type="button"
              onClick={skipCurrent}
              className="px-2.5 py-1.5 rounded-lg bg-amber-900/50 hover:bg-amber-900/70 border border-amber-700/40 text-amber-200 text-xs"
            >
              Skip ahead
            </button>
          )}
          {(status === "running" || status === "between") && (
            <button
              type="button"
              onClick={pause}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs"
            >
              Pause
            </button>
          )}
          {status === "paused" && (
            <button
              type="button"
              onClick={resume}
              className="px-2.5 py-1.5 rounded-lg bg-sky-700 hover:bg-sky-600 border border-sky-600 text-white text-xs"
            >
              Resume
            </button>
          )}
          {status !== "completed" && (
            <button
              type="button"
              onClick={stop}
              className="px-2.5 py-1.5 rounded-lg bg-red-900/50 hover:bg-red-900/70 border border-red-700/40 text-red-200 text-xs"
            >
              Stop
            </button>
          )}
          {status === "completed" && (
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs"
            >
              Close
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {status !== "completed" && (
        <div className="h-1 bg-slate-800">
          <div
            className="h-1 bg-sky-500 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-0 divide-y md:divide-y-0 md:divide-x divide-slate-800">
        {/* Queue list */}
        <div className="max-h-[220px] overflow-y-auto divide-y divide-slate-800/60">
          {batchEntries.map((entry, relIdx) => {
            const absIdx = batchStart + relIdx;
            const res = results[absIdx];
            const isCurrent = absIdx === currentIndex;

            return (
              <div
                key={entry.leadId}
                className={`flex items-center gap-3 px-4 py-2.5 ${isCurrent ? "bg-sky-950/40" : ""}`}
              >
                {statusDot(absIdx, currentIndex, status, results)}
                <div className="min-w-0 flex-1">
                  <p
                    className={`text-sm truncate ${isCurrent ? "text-sky-200 font-medium" : "text-slate-300"}`}
                  >
                    {entry.companyName}
                  </p>
                  {entry.contactName && (
                    <p className="text-xs text-slate-500 truncate">{entry.contactName}</p>
                  )}
                </div>
                {res?.outcome && (
                  <span className="text-xs text-emerald-300/80 shrink-0">
                    {CALL_OUTCOMES.find((o) => o.value === res.outcome)?.label ?? res.outcome}
                  </span>
                )}
                {res?.skipped && (
                  <span className="text-xs text-amber-300/70 shrink-0">Skipped</span>
                )}
                {res?.error && (
                  <span className="text-xs text-red-300/70 shrink-0" title={res.error}>
                    Failed
                  </span>
                )}
              </div>
            );
          })}

          {/* Remaining batches indicator */}
          {totalBatches > 1 && batchNumber < totalBatches && (
            <div className="px-4 py-2 text-xs text-slate-500">
              +{totalCalls - batchEnd} more leads in {totalBatches - batchNumber} remaining batch
              {totalBatches - batchNumber === 1 ? "" : "es"}
            </div>
          )}
        </div>

        {/* Gap quick-outcome / call info */}
        <div className="p-4 space-y-3">
          {status === "between" && currentResult && (
            <>
              <div>
                <p className="text-xs text-slate-500 mb-1">
                  Quick outcome for{" "}
                  <span className="text-slate-300">
                    {entries[currentIndex]?.companyName}
                  </span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {CALL_OUTCOMES.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      onClick={() =>
                        setPendingOutcome(pendingOutcome === o.value ? null : o.value)
                      }
                      className={`px-2.5 py-1 rounded-lg border text-xs transition ${
                        pendingOutcome === o.value
                          ? "bg-emerald-600/30 border-emerald-500/50 text-emerald-200"
                          : "bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                value={pendingNotes}
                onChange={(e) => setPendingNotes(e.target.value)}
                rows={2}
                placeholder="Quick note… (auto-saved)"
                className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-200 placeholder-slate-600 resize-none"
              />
              <p className="text-xs text-slate-500">
                Next call starts in{" "}
                <span className="text-amber-300 font-medium tabular-nums">
                  {gapSecondsLeft ?? GAP_SECONDS}s
                </span>
                . Outcome is saved automatically.
              </p>
            </>
          )}

          {status === "running" && currentEntry && (
            <div className="space-y-1">
              <p className="text-xs text-slate-500">Active call</p>
              <p className="text-sm text-sky-200 font-medium">{currentEntry.companyName}</p>
              {currentEntry.contactName && (
                <p className="text-xs text-slate-400">{currentEntry.contactName}</p>
              )}
              <p className="text-xs text-slate-500">{currentEntry.phone}</p>
              <p className="text-xs text-slate-600 mt-2">
                Outcome form appears during the 3s gap after the call ends.
              </p>
            </div>
          )}

          {status === "paused" && (
            <div className="space-y-1">
              <p className="text-sm text-slate-300">Queue paused.</p>
              <p className="text-xs text-slate-500">
                Press Resume to continue with the next call.
              </p>
            </div>
          )}

          {status === "completed" && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-emerald-300">All calls completed!</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-slate-800 p-2">
                  <p className="text-lg font-bold text-emerald-400">
                    {results.filter((r) => r.callStatus === "completed").length}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">Connected</p>
                </div>
                <div className="rounded-lg bg-slate-800 p-2">
                  <p className="text-lg font-bold text-amber-400">
                    {results.filter((r) => r.skipped).length}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">Skipped</p>
                </div>
                <div className="rounded-lg bg-slate-800 p-2">
                  <p className="text-lg font-bold text-red-400">
                    {results.filter((r) => r.error || (r.callStatus && r.callStatus !== "completed")).length}
                  </p>
                  <p className="text-xs text-slate-500 mt-0.5">No answer</p>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Outcomes can be updated from the call history below.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
