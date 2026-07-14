import { useEffect, useState } from "react";
import { client, type CallHistoryItem } from "../api/client";

interface CallRecordingPanelProps {
  call: CallHistoryItem;
  onUpdated?: (call: CallHistoryItem) => void;
  onError: (message: string) => void;
  compact?: boolean;
}

function transcriptStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case "ready":
      return "Closed captions ready";
    case "processing":
    case "pending":
      return "Generating closed captions…";
    case "failed":
      return "Caption generation failed";
    default:
      return "No captions yet";
  }
}

export function CallRecordingPanel({
  call,
  onUpdated,
  onError,
  compact = false,
}: CallRecordingPanelProps) {
  const [showCaptions, setShowCaptions] = useState(Boolean(call.transcript));
  const [transcribing, setTranscribing] = useState(false);
  const [polling, setPolling] = useState(false);

  const recordingUrl = call.recording_available
    ? client.getCallRecordingUrl(call.id, false)
    : null;
  const downloadUrl = call.recording_available
    ? client.getCallRecordingUrl(call.id, true)
    : null;

  useEffect(() => {
    if (!call.recording_available) return;
    if (call.transcript_status !== "processing" && call.transcript_status !== "pending") {
      return;
    }

    setPolling(true);
    const timer = window.setInterval(async () => {
      try {
        const history = await client.listCallHistory({ page: 1, page_size: 50, since_days: 30 });
        const updated = history.rows.find((item) => item.id === call.id);
        if (!updated) return;
        onUpdated?.(updated);
        if (
          updated.transcript_status === "ready" ||
          updated.transcript_status === "failed"
        ) {
          setPolling(false);
          if (updated.transcript) setShowCaptions(true);
        }
      } catch {
        /* ignore transient poll errors */
      }
    }, 5000);

    return () => {
      window.clearInterval(timer);
      setPolling(false);
    };
  }, [call.id, call.recording_available, call.transcript_status, onUpdated]);

  async function generateCaptions() {
    setTranscribing(true);
    try {
      const updated = await client.transcribeCall(call.id, true);
      onUpdated?.(updated);
      if (updated.transcript_status === "failed" && updated.transcript_error) {
        onError(updated.transcript_error);
      } else {
        setShowCaptions(true);
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to generate closed captions");
    } finally {
      setTranscribing(false);
    }
  }

  if (!call.recording_available) {
    if (compact) return null;
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2">
        <p className="text-xs text-slate-500">
          Recording will appear here after the call ends (Twilio saves it automatically).
        </p>
      </div>
    );
  }

  return (
    <div className={`space-y-3 ${compact ? "" : "pt-1"}`}>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-xs text-slate-500">Call recording</label>
          {call.recording_duration_seconds ? (
            <span className="text-xs text-slate-500">
              {Math.floor(call.recording_duration_seconds / 60)}m{" "}
              {call.recording_duration_seconds % 60}s
            </span>
          ) : null}
        </div>
        {recordingUrl && (
          <audio controls preload="metadata" className="w-full h-10" src={recordingUrl}>
            Your browser does not support audio playback.
          </audio>
        )}
        <div className="flex flex-wrap gap-2">
          {downloadUrl && (
            <a
              href={downloadUrl}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200 no-underline"
            >
              Download recording
            </a>
          )}
          <button
            type="button"
            onClick={() => setShowCaptions((open) => !open)}
            className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs text-slate-200"
          >
            {showCaptions ? "Hide closed captions" : "Show closed captions (CC)"}
          </button>
          <button
            type="button"
            disabled={transcribing || polling}
            onClick={() => void generateCaptions()}
            className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 border border-emerald-600/50 text-xs text-white disabled:opacity-50"
          >
            {transcribing || polling
              ? "Generating CC…"
              : call.transcript
                ? "Regenerate CC"
                : "Generate CC"}
          </button>
        </div>
        <p className="text-xs text-slate-500">
          {transcriptStatusLabel(call.transcript_status)}
          {call.transcript_error ? ` — ${call.transcript_error}` : ""}
        </p>
      </div>

      {showCaptions && (
        <div className="rounded-lg border border-slate-700 bg-slate-950 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Closed captions
            </h4>
            {call.transcript && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(call.transcript ?? "");
                }}
                className="text-xs text-sky-400 hover:text-sky-300"
              >
                Copy
              </button>
            )}
          </div>
          {call.transcript ? (
            <pre className="whitespace-pre-wrap text-sm text-slate-200 font-sans leading-relaxed max-h-64 overflow-y-auto">
              {call.transcript}
            </pre>
          ) : (
            <p className="text-sm text-slate-500">
              {call.transcript_status === "processing" || call.transcript_status === "pending"
                ? "Closed captions are being generated from the recording…"
                : "No closed captions yet. Click Generate CC to create a full word-for-word transcript."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
