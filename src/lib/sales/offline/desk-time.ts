/** Time helpers for the offline desk. The factory works in Pakistan time. */

const PKT_OFFSET = "+05:00";

/** A date as the value a datetime-local box wants, in Pakistan time. */
export function toPktLocalInput(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(value);
  const read = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "00";
  const hour = read("hour") === "24" ? "00" : read("hour");
  return `${read("year")}-${read("month")}-${read("day")}T${hour}:${read("minute")}`;
}

/** A datetime-local value read as Pakistan time. */
export function toPktIso(value: string) {
  return `${value.length === 16 ? `${value}:00` : value}${PKT_OFFSET}`;
}

/**
 * The outage window for the invoices still waiting to be sent: from a minute
 * before the first one until the internet came back (or now, if we did not
 * see it come back). Every invoice time always falls inside it.
 */
export function outageWindow(
  entries: Array<{ saleDate: string; saleTime: string }>,
  restoredAt: Date | null,
  now: Date = new Date(),
) {
  const times = entries
    .map((entry) => new Date(`${entry.saleDate}T${entry.saleTime}:00${PKT_OFFSET}`).getTime())
    .filter((value) => Number.isFinite(value));
  const first = times.length ? Math.min(...times) : now.getTime();
  const last = times.length ? Math.max(...times) : now.getTime();
  const ended = restoredAt && restoredAt.getTime() >= last && restoredAt.getTime() <= now.getTime() ? restoredAt : now;
  return { started: new Date(first - 60_000), ended };
}
