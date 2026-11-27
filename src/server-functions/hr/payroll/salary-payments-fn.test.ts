import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync("src/server-functions/hr/payroll/salary-payments-fn.ts", "utf8");
const blocks = SOURCE.split("export const ").slice(1).map((block) => ({ name: block.slice(0, block.indexOf(" ")), body: block }));

describe("salary payment server functions", () => {
  it("every write needs hr.manage plus finance.manage and runs in one transaction", () => {
    const writes = blocks.filter((b) => b.name.endsWith("Fn") && !b.name.startsWith("get"));
    expect(writes.length).toBeGreaterThan(0);
    for (const write of writes) {
      expect(write.body, write.name).toContain(".middleware([requireHrManageMiddleware])");
      expect(write.body, write.name).toContain('requirePermission(context.authContext, "finance.manage")');
      expect(write.body, write.name).toContain("db.transaction(");
      expect(write.body, write.name).toContain("todayKey: reportDateKey(new Date())");
    }
  });

  it("reads need hr.view", () => {
    for (const read of blocks.filter((b) => b.name.startsWith("get"))) {
      expect(read.body, read.name).toContain(".middleware([requireHrViewMiddleware])");
    }
  });
});
