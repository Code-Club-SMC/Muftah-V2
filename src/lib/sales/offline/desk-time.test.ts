import { describe, expect, it } from "vitest";
import { outageWindow, toPktIso, toPktLocalInput } from "./desk-time";

describe("offline desk time", () => {
  it("reads and writes Pakistan time", () => {
    expect(toPktIso("2026-11-03T09:30")).toBe("2026-11-03T09:30:00+05:00");
    expect(toPktLocalInput(new Date("2026-11-03T04:30:00Z"))).toBe("2026-11-03T09:30");
    // Midnight must not come out as hour 24.
    expect(toPktLocalInput(new Date("2026-11-02T19:00:00Z"))).toBe("2026-11-03T00:00");
  });

  it("starts a minute before the first invoice and ends when the internet came back", () => {
    const entries = [
      { saleDate: "2026-11-03", saleTime: "10:00" },
      { saleDate: "2026-11-03", saleTime: "11:30" },
    ];
    const now = new Date("2026-11-03T08:00:00Z"); // 13:00 in Pakistan
    const restored = new Date("2026-11-03T07:00:00Z"); // 12:00 in Pakistan
    const window = outageWindow(entries, restored, now);
    expect(window.started.toISOString()).toBe("2026-11-03T04:59:00.000Z");
    expect(window.ended).toEqual(restored);
  });

  it("falls back to now when the restore time is unknown or before the last invoice", () => {
    const entries = [{ saleDate: "2026-11-03", saleTime: "11:30" }];
    const now = new Date("2026-11-03T08:00:00Z");
    expect(outageWindow(entries, null, now).ended).toEqual(now);
    // 10:00 Pakistan is before the 11:30 invoice, so it cannot be the end.
    expect(outageWindow(entries, new Date("2026-11-03T05:00:00Z"), now).ended).toEqual(now);
  });

  it("still gives a valid window when nothing is waiting", () => {
    const now = new Date("2026-11-03T08:00:00Z");
    const window = outageWindow([], null, now);
    expect(window.started.getTime()).toBeLessThan(window.ended.getTime());
  });
});
