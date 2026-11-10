import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("how the background refresh is wired", () => {
  it("is mounted at the root, so every page (and the standalone desk page) runs it", () => {
    const root = read("src/routes/__root.tsx");
    expect(root).toContain('import { OfflineDeskRefresher } from "@/components/sales/offline-desk/offline-desk-refresher";');
    expect(root).toContain("<OfflineDeskRefresher />");
  });

  it("fires on a 5-minute timer and on open, focus and internet-restored", () => {
    const hook = read("src/hooks/sales/use-offline-desk-refresher.ts");
    expect(hook).toContain("window.setInterval(run, REFRESH_EVERY_MS)");
    expect(hook).toContain('window.addEventListener("online", run)');
    expect(hook).toContain('window.addEventListener("focus", run)');
    expect(hook).toContain('document.addEventListener("visibilitychange"');
  });

  it("lets only one tab fetch at a time", () => {
    const hook = read("src/hooks/sales/use-offline-desk-refresher.ts");
    expect(hook).toContain("ifAvailable: true");
  });

  it("asks the server with no unsent invoices, because the runner already checked", () => {
    const hook = read("src/hooks/sales/use-offline-desk-refresher.ts");
    expect(hook).toContain("hasUnsentInvoices: false");
  });

  it("replaces the old hourly rule inside the desk hook with a listener for the announcement", () => {
    const desk = read("src/hooks/sales/use-offline-desk.ts");
    expect(desk).not.toContain("60 * 60_000");
    expect(desk).not.toContain("refreshPrices");
    expect(desk).toContain("new BroadcastChannel(DESK_CHANNEL)");
    expect(desk).toContain("waiting: waitingCount(entries)");
  });
});
