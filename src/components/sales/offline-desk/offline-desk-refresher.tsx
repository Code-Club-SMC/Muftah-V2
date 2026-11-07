import { useOfflineDeskRefresher } from "@/hooks/sales/use-offline-desk-refresher";

/** Renders nothing. Keeps the offline desk's saved data fresh from any Titan page. */
export function OfflineDeskRefresher() {
  useOfflineDeskRefresher();
  return null;
}
