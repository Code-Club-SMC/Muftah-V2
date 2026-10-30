import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fn = readFileSync("src/server-functions/reports/production-loss-fn.ts", "utf8");
const queries = readFileSync("src/server-functions/reports/production-loss-queries.server.ts", "utf8");

describe("production loss server functions", () => {
  it("guards reads with the view permission and limits with the manage permission", () => {
    expect(fn.match(/middleware\(\[requireLossReportViewMiddleware\]\)/g)).toHaveLength(2);
    expect(fn).toContain("middleware([requireLossLimitsManageMiddleware])");
    expect(fn).not.toContain("requireReportsViewMiddleware");
  });
  it("filters every tab by the report date range", () => {
    expect(fn).toContain("reportDateBounds(");
    for (const column of ["mixingRuns.actualCompletionDate", "batchPackingReceipts.packedAt", "materialAdjustments.createdAt"])
      expect(queries).toContain(`between(${column}, bounds.fromDate, bounds.toDate)`);
  });
  it("leaves failed batches out and keeps only stock-reducing loss reasons", () => {
    expect(queries.match(/eq\(mixingRuns\.status, "completed"\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(queries).toContain("lt(materialAdjustments.delta, \"0\")");
    expect(queries).toContain("inArray(materialAdjustments.reason, [...STORE_LOSS_REASONS])");
  });
  it("blocks printing more than the row cap", () => {
    expect(fn).toContain("LOSS_PRINT_MAX_ROWS");
    expect(fn).toContain("throw new Error(TOO_MANY_TO_PRINT)");
  });
});
