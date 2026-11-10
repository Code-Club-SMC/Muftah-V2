import { describe, expect, it, vi } from "vitest";
import type { OfflineDeskEntry, OfflineDeskPack } from "./desk-pack";
import { refreshDeskInBackground, type RefreshDeps } from "./desk-refresh-runner";

const NOW = new Date("2026-11-04T10:00:00Z").getTime();
const TEN_MINUTES_OLD = "2026-11-04T09:50:00.000Z";
const NEW = "2026-11-04T10:00:00.000Z";

function pack(patch: { workbookId?: string; generatedAt?: string } = {}): OfflineDeskPack {
  return {
    workbookId: patch.workbookId ?? "wb1",
    operatorName: "Operator",
    issuedAt: "2026-11-01T00:00:00.000Z",
    invoiceCapacity: 500,
    slots: [{ slotNumber: 1, reservedSerial: 1, recordToken: "t1" }],
    reference: {
      generatedAt: patch.generatedAt ?? TEN_MINUTES_OLD,
      distributors: [],
      retailers: [],
      products: [],
      discountRules: [],
      orders: [],
      wallets: [],
      salesmen: [],
    },
  };
}

const waitingEntry = { workbookId: "wb1", slotNumber: 9, status: "printed" } as OfflineDeskEntry;

function setup(over: Partial<RefreshDeps> = {}) {
  const saved: OfflineDeskPack[] = [];
  const deps: RefreshDeps = {
    loadPack: async () => pack(),
    loadEntries: async () => [],
    savePack: async (value) => {
      saved.push(value);
    },
    fetchPack: vi.fn(async () => pack({ generatedAt: NEW })),
    browserOnline: () => true,
    now: () => NOW,
    ...over,
  };
  return { deps, saved };
}

describe("one background refresh", () => {
  it("fetches and saves a newer pack", async () => {
    const { deps, saved } = setup();
    expect(await refreshDeskInBackground(deps)).toEqual({ refreshed: true });
    expect(saved).toHaveLength(1);
    expect(saved[0].reference.generatedAt).toBe(NEW);
  });

  it("does nothing on a computer that was never prepared", async () => {
    const { deps, saved } = setup({ loadPack: async () => null });
    expect(await refreshDeskInBackground(deps)).toEqual({ refreshed: false, reason: "no_pack" });
    expect(deps.fetchPack).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it("does not even ask the server while an invoice waits to be sent", async () => {
    const { deps, saved } = setup({ loadEntries: async () => [waitingEntry] });
    expect(await refreshDeskInBackground(deps)).toEqual({ refreshed: false, reason: "waiting_to_send" });
    expect(deps.fetchPack).not.toHaveBeenCalled();
    expect(saved).toHaveLength(0);
  });

  it("skips data that was refreshed under a minute ago", async () => {
    const { deps } = setup({ loadPack: async () => pack({ generatedAt: "2026-11-04T09:59:30.000Z" }) });
    expect(await refreshDeskInBackground(deps)).toEqual({ refreshed: false, reason: "just_refreshed" });
    expect(deps.fetchPack).not.toHaveBeenCalled();
  });

  it("skips when the browser says it is offline", async () => {
    const { deps } = setup({ browserOnline: () => false });
    expect(await refreshDeskInBackground(deps)).toEqual({ refreshed: false, reason: "offline" });
    expect(deps.fetchPack).not.toHaveBeenCalled();
  });

  it("never swaps in a different set of invoice numbers behind the operator's back", async () => {
    const { deps, saved } = setup({ fetchPack: vi.fn(async () => pack({ workbookId: "wb2", generatedAt: NEW })) });
    expect(await refreshDeskInBackground(deps)).toEqual({ refreshed: false, reason: "other_numbers" });
    expect(saved).toHaveLength(0);
  });

  it("drops the new pack if an invoice was saved while it was being fetched", async () => {
    let reads = 0;
    const { deps, saved } = setup({
      loadEntries: async () => (++reads === 1 ? [] : [waitingEntry]),
    });
    expect(await refreshDeskInBackground(deps)).toEqual({ refreshed: false, reason: "invoice_saved_meanwhile" });
    expect(saved).toHaveLength(0);
  });

  it("stays silent when the server cannot be reached", async () => {
    const { deps, saved } = setup({
      fetchPack: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    expect(await refreshDeskInBackground(deps)).toEqual({ refreshed: false, reason: "failed" });
    expect(saved).toHaveLength(0);
  });

  it("runs two refreshes that start together only once", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetchPack = vi.fn(async () => {
      await gate;
      return pack({ generatedAt: NEW });
    });
    const { deps } = setup({ fetchPack });
    const first = refreshDeskInBackground(deps);
    expect(await refreshDeskInBackground(deps)).toEqual({ refreshed: false, reason: "busy" });
    release();
    expect(await first).toEqual({ refreshed: true });
    expect(fetchPack).toHaveBeenCalledTimes(1);
  });

  it("can refresh again after a failure", async () => {
    const failing = setup({ fetchPack: vi.fn(async () => Promise.reject(new Error("down"))) });
    expect((await refreshDeskInBackground(failing.deps)).refreshed).toBe(false);
    const working = setup();
    expect(await refreshDeskInBackground(working.deps)).toEqual({ refreshed: true });
  });
});
