import type { LeadTableRow } from "../api/client";

function escapeCsv(value: string | null | undefined): string {
  const text = value ?? "";
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function exportLeadsTableCsv(rows: LeadTableRow[], filename = "leads-table.csv") {
  const headers = [
    "Company",
    "Score",
    "Market role",
    "Producer tier",
    "Conversion %",
    "Country",
    "Industry",
    "Contact",
    "Email",
    "Phone",
    "Website",
    "LinkedIn",
    "Source",
    "Added",
    "Scored",
    "Score reasoning",
  ];

  const lines = rows.map((row) =>
    [
      row.company_name,
      row.latest_score ?? "Unscored",
      row.market_role ?? "unknown",
      row.producer_tier ?? "",
      row.producer_conversion_pct != null ? String(Math.round(row.producer_conversion_pct)) : "",
      row.country,
      row.industry,
      row.contact_name,
      row.contact_email,
      row.contact_phone,
      row.website_url,
      row.linkedin_company_url,
      row.source,
      row.created_at,
      row.scored_at,
      row.score_reasoning,
    ]
      .map(escapeCsv)
      .join(","),
  );

  const csv = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
