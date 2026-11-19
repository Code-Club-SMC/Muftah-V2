import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { reservationReason } from "./compensatory-ledger";

describe("reservationReason", () => {
  it("names hours taken from and returned to the bank", () => {
    expect(reservationReason("comp_leave", -8)).toBe("comp_leave_reserved");
    expect(reservationReason("comp_leave", 8)).toBe("comp_leave_released");
    expect(reservationReason("bank_cover", -0.5)).toBe("bank_cover_applied");
    expect(reservationReason("bank_cover", 0.5)).toBe("bank_cover_removed");
    expect(reservationReason("cash_out", -4)).toBe("cash_out");
    expect(reservationReason("cash_out", 4)).toBe("cash_out_cancelled");
  });
});

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("comp-off bank history coverage", () => {
  it("writes the bank balance only through the history helper", () => {
    const writers = [...sourceFiles("src/server-functions"), ...sourceFiles("src/lib")].filter(
      (file) => /\.set\(\{[^}]*compensatoryHoursBalance/s.test(readFileSync(file, "utf8")),
    );
    expect(writers).toEqual([join("src/lib/attendance/compensatory-reservation.server.ts")]);
  });
});
