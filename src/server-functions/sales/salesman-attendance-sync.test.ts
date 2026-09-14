import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const SYNC_SOURCE = readFileSync(
  resolve("src/server-functions/sales/salesman-attendance-sync.ts"),
  "utf8",
);

describe("salesman-attendance-sync contract", () => {
  it("exports syncSalesmanAttendanceForDate and constant", () => {
    expect(SYNC_SOURCE).toContain("export const SALESMAN_ACTIVITY_ENTRY_SOURCE = \"salesman_activity\"");
    expect(SYNC_SOURCE).toContain("export async function syncSalesmanAttendanceForDate");
  });

  it("checks both order deliveries and recovery attempts but excludes invoices", () => {
    expect(SYNC_SOURCE).toContain("fulfilledBySalesmanId");
    expect(SYNC_SOURCE).toContain("creditRecoveryAttempts");
    expect(SYNC_SOURCE).not.toContain("invoices.salesmanId");
  });

  it("protects manual HR attendance rows from overwrite", () => {
    expect(SYNC_SOURCE).toContain("entrySource !== SALESMAN_ACTIVITY_ENTRY_SOURCE");
    expect(SYNC_SOURCE).toContain("return { status: \"skipped_manual\" }");
  });

  it("deletes auto-generated row when activities drop to zero", () => {
    expect(SYNC_SOURCE).toContain(".delete(attendance)");
    expect(SYNC_SOURCE).toContain("existingAttendance.entrySource === SALESMAN_ACTIVITY_ENTRY_SOURCE");
  });

  it("sets checkIn and checkOut to null with standard duty hours", () => {
    expect(SYNC_SOURCE).toContain("checkIn: null");
    expect(SYNC_SOURCE).toContain("checkOut: null");
    expect(SYNC_SOURCE).toContain("dutyHours");
  });
});
