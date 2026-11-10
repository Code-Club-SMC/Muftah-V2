import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { canAccessPath } from "@/lib/rbac";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("sales returns pages", () => {
  it("adds the list and detail routes under sales view", () => {
    expect(existsSync(resolve(process.cwd(), "src/routes/_protected/sales/returns/index.tsx"))).toBe(true);
    expect(existsSync(resolve(process.cwd(), "src/routes/_protected/sales/returns/$returnId.tsx"))).toBe(true);
    expect(canAccessPath("/sales/returns", ["sales.view"])).toBe(true);
    expect(canAccessPath("/sales/returns/ret-1", ["sales.view"])).toBe(true);
    expect(canAccessPath("/sales/returns", ["inventory.view"])).toBe(false);
    expect(read("src/lib/constants.ts")).toContain('url: "/sales/returns"');
  });

  it("opens on the work-queue tabs with counts and search", () => {
    const list = read("src/routes/_protected/sales/returns/index.tsx");
    for (const label of ["To approve", "To receive", "Done", "All"]) expect(list).toContain(`label: "${label}"`);
    expect(list).toContain("data?.counts[tabItem.value]");
    expect(list).toContain("Return #, invoice # or customer");
  });

  it("shows progress, a who-and-when timeline and the next actions on the detail page", () => {
    const detail = read("src/routes/_protected/sales/returns/$returnId.tsx");
    expect(detail).toContain("<ReturnProgress");
    expect(detail).toContain("<ReturnActions");
    expect(detail).toContain("buildReturnTimeline(");
  });
});
