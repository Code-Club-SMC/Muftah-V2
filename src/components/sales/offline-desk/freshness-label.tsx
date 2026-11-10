import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { OfflineDesk } from "@/hooks/sales/use-offline-desk";
import { describeFreshness, type Freshness } from "@/lib/sales/offline/desk-refresh";

/**
 * How old the saved data is, in words. Re-reads the clock every 20 seconds so
 * "2 min ago" keeps moving while the page stays open. Null until prepared.
 */
export function useFreshness(desk: OfflineDesk): Freshness | null {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 20_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!desk.pack) return null;
  return describeFreshness({
    generatedAt: desk.pack.reference.generatedAt,
    now,
    online: desk.online,
    waiting: desk.waiting,
  });
}

export function FreshnessBadge({ desk }: { desk: OfflineDesk }) {
  const freshness = useFreshness(desk);
  if (!freshness) return null;
  const warn = freshness.tone === "stale" || freshness.tone === "paused";
  return (
    <Badge
      variant="outline"
      className={`h-auto whitespace-normal text-left ${warn ? "border-amber-500/60 text-amber-500" : ""}`}
    >
      {freshness.text}
    </Badge>
  );
}
