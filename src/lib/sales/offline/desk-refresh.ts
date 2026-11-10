import type { OfflineDeskPack } from "./desk-pack";

/** How often the desk's saved data is refreshed while a Titan tab is open. */
export const REFRESH_EVERY_MS = 5 * 60_000;
/** Data this new is left alone: another tab (or a moment ago) just refreshed it. */
export const JUST_REFRESHED_MS = 60_000;
/** Online and older than this: the label turns amber. */
export const STALE_AFTER_MS = 15 * 60_000;

/** Tabs tell each other over this channel when new data was saved. */
export const DESK_CHANNEL = "titan-offline-desk";
export const PACK_UPDATED = "pack-updated";

const TIME_ZONE = "Asia/Karachi";

/**
 * An invoice is waiting until the office has it. A saved, printed or cancelled
 * invoice is still on this computer, so it waits just the same.
 */
export function hasInvoicesWaiting(entries: Array<{ status: string }>) {
  return entries.some((entry) => entry.status !== "sent");
}

export function waitingCount(entries: Array<{ status: string }>) {
  return entries.filter((entry) => entry.status !== "sent").length;
}

/** Invoice numbers in the saved pack that no invoice on this computer has taken yet. */
export function freeNumberCount(
  pack: Pick<OfflineDeskPack, "workbookId" | "slots">,
  entries: Array<{ workbookId: string; slotNumber: number }>,
) {
  const used = new Set(
    entries.filter((entry) => entry.workbookId === pack.workbookId).map((entry) => entry.slotNumber),
  );
  return pack.slots.filter((slot) => !used.has(slot.slotNumber)).length;
}

export type RefreshSkip = "no_pack" | "offline" | "waiting_to_send" | "no_numbers" | "just_refreshed";
export type RefreshDecision = { run: true } | { run: false; reason: RefreshSkip };

/**
 * Whether a background refresh should go ahead right now. The order matters
 * only for which reason is reported; any single reason is enough to skip.
 */
export function decideRefresh(input: {
  hasPack: boolean;
  browserOnline: boolean;
  /** Invoices on this computer that the office does not have yet. */
  waiting: number;
  /** Invoice numbers still free. With none left the operator asks for a new set by hand. */
  freeNumbers: number;
  dataAgeMs: number;
}): RefreshDecision {
  if (!input.hasPack) return { run: false, reason: "no_pack" };
  if (!input.browserOnline) return { run: false, reason: "offline" };
  if (input.waiting > 0) return { run: false, reason: "waiting_to_send" };
  if (input.freeNumbers <= 0) return { run: false, reason: "no_numbers" };
  if (input.dataAgeMs < JUST_REFRESHED_MS) return { run: false, reason: "just_refreshed" };
  return { run: true };
}

export function formatAge(ms: number) {
  const minutes = Math.floor(Math.max(0, ms) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function clock(value: Date) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(value);
}

function dayOf(value: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(value);
}

/** `14:35` for today, `3 Nov, 14:35` for an earlier day. Pakistan time. */
export function formatClock(value: Date, now: Date) {
  const time = clock(value);
  if (dayOf(value) === dayOf(now)) return time;
  const day = new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, day: "numeric", month: "short" }).format(value);
  return `${day}, ${time}`;
}

export type Freshness = { text: string; tone: "ok" | "stale" | "paused" | "offline" };

/** The words (and the mood) for "when was the saved data last brought up to date". */
export function describeFreshness(input: {
  /** When the server built the copy this computer holds. */
  generatedAt: string;
  now: Date;
  online: boolean;
  waiting: number;
}): Freshness {
  const generated = new Date(input.generatedAt);
  const age = input.now.getTime() - generated.getTime();
  const at = formatClock(generated, input.now);
  if (!input.online) return { tone: "offline", text: `Updated ${at} · before internet went off` };
  if (input.waiting > 0) {
    const noun = input.waiting === 1 ? "invoice" : "invoices";
    return {
      tone: "paused",
      text: `Updates paused: ${input.waiting} ${noun} waiting to be sent. Data from ${at}.`,
    };
  }
  return { tone: age > STALE_AFTER_MS ? "stale" : "ok", text: `Updated ${formatAge(age)} · ${at}` };
}
