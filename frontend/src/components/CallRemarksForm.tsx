import { CALL_OUTCOMES, type CallOutcome } from "../utils/callOutcomes";

interface CallRemarksFormProps {
  remarks: string;
  outcome: CallOutcome | "";
  onRemarksChange: (value: string) => void;
  onOutcomeChange: (value: CallOutcome | "") => void;
  onSave: () => void;
  saving?: boolean;
  saveLabel?: string;
  compact?: boolean;
}

export function CallRemarksForm({
  remarks,
  outcome,
  onRemarksChange,
  onOutcomeChange,
  onSave,
  saving = false,
  saveLabel = "Save remarks",
  compact = false,
}: CallRemarksFormProps) {
  return (
    <div className={`space-y-3 ${compact ? "" : "pt-1"}`}>
      <div className="space-y-2">
        <label className="text-xs text-slate-500">Call outcome</label>
        <select
          value={outcome}
          onChange={(e) => onOutcomeChange(e.target.value as CallOutcome | "")}
          className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
        >
          <option value="">Select outcome…</option>
          {CALL_OUTCOMES.map((item) => (
            <option key={item.value} value={item.value}>
              {item.label}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <label className="text-xs text-slate-500">Remarks</label>
        <textarea
          value={remarks}
          onChange={(e) => onRemarksChange(e.target.value)}
          rows={compact ? 4 : 5}
          placeholder="Products discussed, follow-up date, objections, next steps…"
          className="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2 text-sm text-slate-200"
        />
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={onSave}
        className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm disabled:opacity-50"
      >
        {saving ? "Saving…" : saveLabel}
      </button>
    </div>
  );
}
