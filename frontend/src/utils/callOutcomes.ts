export const CALL_OUTCOMES = [
  { value: "interested", label: "Interested" },
  { value: "not_interested", label: "Not interested" },
  { value: "not_received_call", label: "Did not receive call" },
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number]["value"];

export function callOutcomeLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return CALL_OUTCOMES.find((item) => item.value === value)?.label ?? value;
}

export function callOutcomeBadge(value: string | null | undefined): string {
  if (value === "interested") {
    return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
  }
  if (value === "not_interested") {
    return "bg-red-500/15 text-red-300 border-red-500/30";
  }
  if (value === "not_received_call") {
    return "bg-amber-500/15 text-amber-300 border-amber-500/30";
  }
  return "bg-slate-700/50 text-slate-300 border-slate-600";
}

export function callOutcomeListNotice(value: string | null | undefined): string | null {
  if (value === "interested") return "Client moved to Follow up clients.";
  if (value === "not_interested") return "Client moved to Not interested.";
  if (value === "not_received_call") return "Client moved to Did not receive call.";
  return null;
}

export function callOutcomeSectionHint(value: CallOutcome | ""): string | null {
  if (value === "interested") {
    return "Client moves from Leads table or Old clients to Follow up clients.";
  }
  if (value === "not_interested") {
    return "Client moves from Leads table or Old clients to Not interested.";
  }
  if (value === "not_received_call") {
    return "Client moves from Leads table or Old clients to Did not receive call.";
  }
  return null;
}
