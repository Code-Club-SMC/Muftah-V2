import type { OfflineDeskEntry, OfflineDeskPack } from "./desk-pack";
import {
  decideRefresh,
  freeNumberCount,
  hasInvoicesWaiting,
  type RefreshSkip,
  waitingCount,
} from "./desk-refresh";

/** Everything a refresh touches, passed in so it can be tested without a browser. */
export type RefreshDeps = {
  loadPack: () => Promise<OfflineDeskPack | null>;
  loadEntries: () => Promise<OfflineDeskEntry[]>;
  savePack: (pack: OfflineDeskPack) => Promise<void>;
  fetchPack: () => Promise<OfflineDeskPack>;
  browserOnline: () => boolean;
  now?: () => number;
};

export type RefreshOutcome =
  | { refreshed: true }
  | {
      refreshed: false;
      reason: RefreshSkip | "busy" | "failed" | "other_numbers" | "invoice_saved_meanwhile";
    };

// One refresh at a time in this tab. Set before the first await so two triggers
// that fire together (focus and visibility change) cannot both get through.
let running = false;

/**
 * Brings the saved pack up to date if it is safe to. Never throws: a refresh
 * that fails changes nothing and the next round simply tries again.
 */
export async function refreshDeskInBackground(deps: RefreshDeps): Promise<RefreshOutcome> {
  if (running) return { refreshed: false, reason: "busy" };
  running = true;
  try {
    const pack = await deps.loadPack();
    const entries = pack ? await deps.loadEntries() : [];
    const now = (deps.now ?? Date.now)();
    const decision = decideRefresh({
      hasPack: Boolean(pack),
      browserOnline: deps.browserOnline(),
      waiting: waitingCount(entries),
      freeNumbers: pack ? freeNumberCount(pack, entries) : 0,
      dataAgeMs: pack ? now - new Date(pack.reference.generatedAt).getTime() : Number.POSITIVE_INFINITY,
    });
    if (!decision.run) return { refreshed: false, reason: decision.reason };
    if (!pack) return { refreshed: false, reason: "no_pack" };

    const fresh = await deps.fetchPack();
    // The server hands out a new set of numbers only when the old set is used
    // up. The operator asks for that by hand, so do not swap it in silently.
    if (fresh.workbookId !== pack.workbookId) return { refreshed: false, reason: "other_numbers" };
    // An invoice may have been saved during the fetch. It must keep matching the
    // prices it was made with, so leave the old pack in place.
    if (hasInvoicesWaiting(await deps.loadEntries())) {
      return { refreshed: false, reason: "invoice_saved_meanwhile" };
    }
    await deps.savePack(fresh);
    return { refreshed: true };
  } catch {
    return { refreshed: false, reason: "failed" };
  } finally {
    running = false;
  }
}
