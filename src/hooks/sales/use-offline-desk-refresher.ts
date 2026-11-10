import { useEffect } from "react";
import { DESK_CHANNEL, PACK_UPDATED, REFRESH_EVERY_MS } from "@/lib/sales/offline/desk-refresh";
import { refreshDeskInBackground } from "@/lib/sales/offline/desk-refresh-runner";
import { loadEntries, loadPack, savePack } from "@/lib/sales/offline/desk-store";
import { getOfflineSalesPackFn } from "@/server-functions/sales/offline-entries-fn";

const LOCK_NAME = "titan-offline-desk-refresh";

let channel: BroadcastChannel | null = null;

/** Tells every open tab (the desk page included) to reload what is in storage. */
function announce() {
  if (typeof BroadcastChannel === "undefined") return;
  channel ??= new BroadcastChannel(DESK_CHANNEL);
  channel.postMessage(PACK_UPDATED);
}

async function attempt() {
  const work = async () => {
    const outcome = await refreshDeskInBackground({
      loadPack,
      loadEntries,
      savePack,
      // The runner has already checked that nothing is waiting to be sent.
      fetchPack: () => getOfflineSalesPackFn({ data: { hasUnsentInvoices: false } }),
      browserOnline: () => navigator.onLine,
    });
    if (outcome.refreshed) announce();
  };
  // With several Titan tabs open, only one fetches per round. The others skip it.
  if (typeof navigator !== "undefined" && "locks" in navigator) {
    await navigator.locks.request(LOCK_NAME, { ifAvailable: true }, async (lock) => {
      if (lock) await work();
    });
    return;
  }
  await work();
}

/**
 * Keeps the offline desk's saved data fresh from whichever Titan page is open.
 * Runs once on open, every 5 minutes, when the tab is focused again, and when
 * the internet returns. A computer that was never prepared does nothing.
 */
export function useOfflineDeskRefresher() {
  useEffect(() => {
    const run = () => void attempt().catch(() => undefined);
    const onVisible = () => {
      if (document.visibilityState === "visible") run();
    };
    run();
    const timer = window.setInterval(run, REFRESH_EVERY_MS);
    window.addEventListener("online", run);
    window.addEventListener("focus", run);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", run);
      window.removeEventListener("focus", run);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
