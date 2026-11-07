import { describe, expect, it } from "vitest";
import {
  decideRefresh,
  describeFreshness,
  formatAge,
  formatClock,
  freeNumberCount,
  hasInvoicesWaiting,
  JUST_REFRESHED_MS,
  waitingCount,
} from "./desk-refresh";

const ready = { hasPack: true, browserOnline: true, waiting: 0, freeNumbers: 10, dataAgeMs: 10 * 60_000 };

describe("when the desk refreshes", () => {
  it("runs on a prepared, online computer with nothing waiting and data that is not brand new", () => {
    expect(decideRefresh(ready)).toEqual({ run: true });
  });

  it.each([
    ["no_pack", { hasPack: false }],
    ["offline", { browserOnline: false }],
    ["waiting_to_send", { waiting: 3 }],
    ["no_numbers", { freeNumbers: 0 }],
    ["just_refreshed", { dataAgeMs: JUST_REFRESHED_MS - 1 }],
  ])("skips with reason %s", (reason, patch) => {
    expect(decideRefresh({ ...ready, ...patch })).toEqual({ run: false, reason });
  });
});

describe("invoices waiting to be sent", () => {
  const list = (...statuses: string[]) => statuses.map((status) => ({ status }));

  it("counts saved, printed and cancelled invoices, but not sent ones", () => {
    const entries = list("saved", "printed", "cancelled", "sent");
    expect(hasInvoicesWaiting(entries)).toBe(true);
    expect(waitingCount(entries)).toBe(3);
    expect(hasInvoicesWaiting(list("sent"))).toBe(false);
    expect(hasInvoicesWaiting([])).toBe(false);
  });

  it("counts the invoice numbers still free in this workbook only", () => {
    const slots = [1, 2, 3].map((slotNumber) => ({ slotNumber, reservedSerial: slotNumber, recordToken: `t${slotNumber}` }));
    const used = [
      { workbookId: "wb1", slotNumber: 1 },
      { workbookId: "wb0", slotNumber: 2 }, // an older workbook, does not count
    ];
    expect(freeNumberCount({ workbookId: "wb1", slots }, used)).toBe(2);
  });
});

describe("how old the data looks", () => {
  it("rounds down to minutes, hours and days", () => {
    expect(formatAge(20_000)).toBe("just now");
    expect(formatAge(90_000)).toBe("1 min ago");
    expect(formatAge(59 * 60_000)).toBe("59 min ago");
    expect(formatAge(3 * 3_600_000)).toBe("3 h ago");
    expect(formatAge(24 * 3_600_000)).toBe("1 day ago");
    expect(formatAge(49 * 3_600_000)).toBe("2 days ago");
    expect(formatAge(-5_000)).toBe("just now");
  });

  it("shows the Pakistan clock, with the date when it was not today", () => {
    const now = new Date("2026-11-04T10:00:00Z");
    expect(formatClock(new Date("2026-11-04T09:35:00Z"), now)).toBe("14:35");
    expect(formatClock(new Date("2026-11-03T09:35:00Z"), now)).toBe("3 Nov, 14:35");
  });
});

describe("the last-refreshed label", () => {
  const generatedAt = "2026-11-04T09:35:00Z"; // 14:35 in Pakistan

  it("is plain when online and recent", () => {
    const now = new Date("2026-11-04T09:37:00Z");
    expect(describeFreshness({ generatedAt, now, online: true, waiting: 0 })).toEqual({
      tone: "ok",
      text: "Updated 2 min ago · 14:35",
    });
  });

  it("turns stale after 15 minutes online", () => {
    const fifteen = new Date("2026-11-04T09:50:00Z");
    const sixteen = new Date("2026-11-04T09:51:00Z");
    expect(describeFreshness({ generatedAt, now: fifteen, online: true, waiting: 0 }).tone).toBe("ok");
    expect(describeFreshness({ generatedAt, now: sixteen, online: true, waiting: 0 })).toEqual({
      tone: "stale",
      text: "Updated 16 min ago · 14:35",
    });
  });

  it("says updates are paused while invoices wait to be sent", () => {
    const now = new Date("2026-11-04T09:37:00Z");
    expect(describeFreshness({ generatedAt, now, online: true, waiting: 3 })).toEqual({
      tone: "paused",
      text: "Updates paused: 3 invoices waiting to be sent. Data from 14:35.",
    });
    expect(describeFreshness({ generatedAt, now, online: true, waiting: 1 }).text).toBe(
      "Updates paused: 1 invoice waiting to be sent. Data from 14:35.",
    );
  });

  it("shows the last update time, without an age, when offline", () => {
    const now = new Date("2026-11-04T12:00:00Z");
    expect(describeFreshness({ generatedAt, now, online: false, waiting: 3 })).toEqual({
      tone: "offline",
      text: "Updated 14:35 · before internet went off",
    });
  });
});
