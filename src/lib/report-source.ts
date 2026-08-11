export const REPORT_SOURCES = ["all", "online", "offline_import"] as const;

export type ReportSource = (typeof REPORT_SOURCES)[number];

export function parseReportSource(value: unknown): ReportSource {
  return REPORT_SOURCES.includes(value as ReportSource)
    ? (value as ReportSource)
    : "all";
}

export function reportSourceLabel(source: ReportSource) {
  if (source === "online") return "Online invoices";
  if (source === "offline_import") return "Offline Excel invoices";
  return "All invoices";
}
