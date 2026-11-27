import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(resolve(__dirname, "..", path), "utf8");

describe("Supplier pages work for a user who can only see suppliers", () => {
  for (const path of ["routes/_protected/suppliers/$supplierId.tsx", "routes/_protected/suppliers/$supplierId_.details.tsx"]) {
    it(`${path} loads stores only with inventory.view`, () => {
      const source = read(path);
      // Stores come from inventory, which a supplier-only user can't read.
      expect(source).not.toMatch(/useSuspenseQuery\(\{\s*queryKey: \["inventory"\]/);
      expect(source).toMatch(/queryKey: \["inventory"\],\s*queryFn: getInventoryFn,\s*enabled: canViewInventory/);
    });
  }

  it("the overview loader skips inventory without the permission", () => {
    const source = read("routes/_protected/suppliers/$supplierId.tsx");
    expect(source).toMatch(/hasPermission\(context\.viewerAccess\.permissions, "inventory\.view"\)/);
  });
});

describe("Adding a purchase keeps what was typed", () => {
  for (const path of ["server-functions/inventory/add-chemical-fn.ts", "server-functions/inventory/add-packaging-material-fn.ts"]) {
    it(`${path} saves the invoice number and leaves notes blank when none were typed`, () => {
      const source = read(path);
      expect(source).toContain("invoiceNumber: data.invoiceNumber?.trim() || null");
      expect(source).not.toContain('"Initial Stock"');
    });
  }
});
