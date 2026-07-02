interface ScoreBadgeProps {
  score: string;
}

const colors: Record<string, string> = {
  HOT: "bg-red-500/20 text-red-300 border-red-500/40",
  WARM: "bg-amber-500/20 text-amber-300 border-amber-500/40",
  COLD: "bg-slate-500/20 text-slate-300 border-slate-500/40",
  DRAFT: "bg-slate-500/20 text-slate-300 border-slate-500/40",
  APPROVED: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
};

export function ScoreBadge({ score }: ScoreBadgeProps) {
  const key = score.toUpperCase();
  return (
    <span
      className={`px-2 py-0.5 rounded border text-xs font-medium ${colors[key] ?? colors.COLD}`}
    >
      {score}
    </span>
  );
}
