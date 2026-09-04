const PKT_OFFSET_MS = 5 * 60 * 60 * 1000;

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

function toPKTDateObject(value: string | Date): Date {
  return new Date(toDate(value).getTime() + PKT_OFFSET_MS);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Pakistan Standard Time is UTC+5 with no DST, so a fixed offset is enough.
 */
export function toPKTDate(value: string | Date): string {
  const date = toPKTDateObject(value);
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join("-");
}

export function toPKTTime(value: string | Date): string {
  const date = toPKTDateObject(value);
  return [
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join(":");
}

export function nowPKTDate(): string {
  return toPKTDate(new Date());
}

export function calculateTotalShiftHours(
  shifts?: { start: string; end: string }[] | null,
): number {
  if (!shifts || shifts.length === 0) return 0;
  let totalMinutes = 0;
  for (const s of shifts) {
    if (!s.start || !s.end) continue;
    const [sh, sm] = s.start.split(":").map(Number);
    const [eh, em] = s.end.split(":").map(Number);
    if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) continue;
    let diff = eh * 60 + em - (sh * 60 + sm);
    if (diff < 0) diff += 24 * 60; // Handle overnight shift
    totalMinutes += diff;
  }
  return Math.round((totalMinutes / 60) * 100) / 100;
}
