interface CallRecommendationBadgeProps {
  recommended: boolean | null;
  localTime: string | null;
  reason: string | null;
}

export function CallRecommendationBadge({
  recommended,
  localTime,
  reason,
}: CallRecommendationBadgeProps) {
  if (recommended === null) {
    return (
      <span
        className="px-2 py-0.5 rounded border text-xs font-medium whitespace-nowrap bg-slate-700/30 text-slate-400 border-slate-600/40"
        title={reason ?? "Unknown local time"}
      >
        Unknown
      </span>
    );
  }

  const label = recommended ? "Call now" : "Not now";
  const colors = recommended
    ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
    : "bg-rose-500/20 text-rose-300 border-rose-500/40";

  return (
    <span
      className={`px-2 py-0.5 rounded border text-xs font-medium whitespace-nowrap ${colors}`}
      title={reason ?? undefined}
    >
      {label}
      {localTime ? ` · ${localTime}` : ""}
    </span>
  );
}
