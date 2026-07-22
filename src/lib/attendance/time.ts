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
