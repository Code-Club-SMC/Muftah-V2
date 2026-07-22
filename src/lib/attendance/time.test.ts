import { describe, expect, it } from "vitest";
import { toPKTDate, toPKTTime } from "./time";

describe("PKT time helpers", () => {
  it("converts UTC timestamps to Pakistan date and time", () => {
    const timestamp = "2026-06-01T03:15:30.000Z";

    expect(toPKTDate(timestamp)).toBe("2026-06-01");
    expect(toPKTTime(timestamp)).toBe("08:15:30");
  });

  it("moves the date forward when UTC plus five crosses midnight", () => {
    const timestamp = "2026-06-01T21:30:00.000Z";

    expect(toPKTDate(timestamp)).toBe("2026-06-02");
    expect(toPKTTime(timestamp)).toBe("02:30:00");
  });
});

