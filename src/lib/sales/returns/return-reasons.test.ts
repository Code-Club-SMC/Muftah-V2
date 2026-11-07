import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("return reason codes", () => {
  it("seeds the defaults only when the list is empty", () => {
    const seed = read("src/lib/sales/returns/return-reasons.server.ts");
    expect(seed).toContain("DEFAULT_RETURN_REASONS");
    expect(seed).toContain("if (Number(existing?.total ?? 0) > 0) return;");
    expect(seed).toContain(".onConflictDoNothing()");
  });

  it("lets everyone in sales read reasons and only config managers change them", () => {
    const fn = read("src/server-functions/sales/return-reasons-fn.ts");
    expect(fn).toContain("export const getReturnReasonsFn");
    expect(fn).toContain(".middleware([requireSalesViewMiddleware])");
    expect(fn).toContain("export const saveReturnReasonFn");
    expect(fn).toContain(".middleware([requireSalesConfigManageMiddleware])");
    expect(fn).toContain("await ensureReturnReasonsSeeded(db)");
    expect(fn).toContain('A reason called "${name}" already exists.');
    expect(fn).not.toContain('import { db } from "@/db"');
  });
});
