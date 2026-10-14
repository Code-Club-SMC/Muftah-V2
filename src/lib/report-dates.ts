/** Reports use Pakistan calendar days. Picker values instead retain their local calendar fields. */
const TIME_ZONE = "Asia/Karachi";
const DAY_MS = 86_400_000;
const keyFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function validateKey(key: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("Invalid report date");
  const date = new Date(`${key}T00:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== key
  )
    throw new Error("Invalid report date");
  return key;
}

export function reportDateKey(value: Date | string): string {
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return validateKey(value);
    if (
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(
        value,
      )
    )
      throw new Error("Invalid report timestamp");
    validateKey(value.slice(0, 10));
    const [hour, minute, second] = value.slice(11, 19).split(":").map(Number);
    const offset = value.match(/[+-](\d{2}):(\d{2})$/);
    if (
      hour > 23 ||
      minute > 59 ||
      second > 59 ||
      (offset && (Number(offset[1]) > 23 || Number(offset[2]) > 59))
    )
      throw new Error("Invalid report timestamp");
  }
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime()))
    throw new Error("Invalid report timestamp");
  const parts = keyFormatter.formatToParts(date);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function datePickerKey(value: Date): string {
  if (!Number.isFinite(value.getTime())) throw new Error("Invalid picker date");
  return validateKey(
    `${value.getFullYear().toString().padStart(4, "0")}-${(value.getMonth() + 1).toString().padStart(2, "0")}-${value.getDate().toString().padStart(2, "0")}`,
  );
}

export function reportDateBounds(input: {
  dateFrom?: string;
  dateTo?: string;
}): { fromDate?: Date; toDate?: Date } {
  const from =
    input.dateFrom === undefined ? undefined : reportDateKey(input.dateFrom);
  const to =
    input.dateTo === undefined ? undefined : reportDateKey(input.dateTo);
  if (from && to && from > to)
    throw new Error("Report start date must not be after end date");
  return {
    ...(from ? { fromDate: new Date(`${from}T00:00:00+05:00`) } : {}),
    ...(to ? { toDate: new Date(`${to}T23:59:59.999+05:00`) } : {}),
  };
}

export function formatReportDate(value: Date | string): string {
  const key = reportDateKey(value);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${key}T00:00:00Z`));
}

export function formatReportTimestamp(value: Date | string): string {
  reportDateKey(value);
  const date =
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? new Date(`${value}T00:00:00+05:00`)
      : new Date(value);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${formatReportDate(value)}, ${time} PKT`;
}

/** Calendar arithmetic uses UTC solely as a calendar container, never a reporting instant. */
export function reportMonth(
  value: Date | string,
  offset = 0,
): { from: string; to: string } {
  const key = reportDateKey(value);
  const date = new Date(`${key.slice(0, 7)}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  const from = date.toISOString().slice(0, 10);
  date.setUTCMonth(date.getUTCMonth() + 1);
  return {
    from,
    to: new Date(date.getTime() - DAY_MS).toISOString().slice(0, 10),
  };
}

export function currentReportMonth(): { from: string; to: string } {
  return reportMonth(new Date());
}

export function shiftReportDate(value: Date | string, days: number): string {
  return new Date(
    new Date(`${reportDateKey(value)}T00:00:00Z`).getTime() + days * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);
}

export function formatReportMonth(value: Date | string): string {
  return formatReportDate(value).slice(3);
}
