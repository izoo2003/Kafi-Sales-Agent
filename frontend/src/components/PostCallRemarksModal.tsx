import { useEffect, useState } from "react";
import { client } from "../api/client";
import { useTwilioVoice } from "../hooks/useTwilioVoice";
import { type CallOutcome, callOutcomeSectionHint } from "../utils/callOutcomes";
import { CallRemarksForm } from "./CallRemarksForm";

interface PostCallRemarksModalProps {
  onError: (message: string) => void;
  onSaved?: (outcome: string | null | undefined) => void;
}

export function PostCallRemarksModal({ onError, onSaved }: PostCallRemarksModalProps) {
  const { pendingFollowUp, clearPendingFollowUp, bulkModeActive } = useTwilioVoice();
  const [remarks, setRemarks] = useState("");
  const [outcome, setOutcome] = useState<CallOutcome | "">("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!pendingFollowUp) return;
    setRemarks("");
    setOutcome("");
  }, [pendingFollowUp]);

  // Suppress this modal when the bulk call queue is active — it handles outcomes inline.
  if (!pendingFollowUp || bulkModeActive) return null;

  async function saveRemarks() {
    if (!pendingFollowUp) return;
    setSaving(true);
    try {
      await client.updateCallFollowUp(pendingFollowUp.interactionId, {
        notes: remarks,
        call_outcome: outcome || null,
      });
      clearPendingFollowUp();
      onSaved?.(outcome || null);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Failed to save call remarks");
    } finally {
      setSaving(false);
    }
  }

  function dismiss() {
    clearPendingFollowUp();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div
        className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 shadow-2xl p-5 space-y-4"
        role="dialog"
        aria-labelledby="post-call-title"
      >
        <div>
          <h3 id="post-call-title" className="text-lg font-medium text-slate-100">
            Call finished
          </h3>
          <p className="text-sm text-slate-400 mt-1">
            Add remarks and label the outcome for{" "}
            <span className="text-slate-200">{pendingFollowUp.label}</span>.
            {callOutcomeSectionHint(outcome) ? (
              <span className="block mt-1 text-emerald-300/90">
                {callOutcomeSectionHint(outcome)}
              </span>
            ) : null}
          </p>
        </div>
        <CallRemarksForm
          remarks={remarks}
          outcome={outcome}
          onRemarksChange={setRemarks}
          onOutcomeChange={setOutcome}
          onSave={() => void saveRemarks()}
          saving={saving}
          saveLabel="Save and close"
          compact
        />
        <button
          type="button"
          onClick={dismiss}
          className="text-sm text-slate-400 hover:text-slate-200"
        >
          Skip for now
        </button>
      </div>
    </div>
  );
}
