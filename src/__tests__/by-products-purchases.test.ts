// src/__tests__/by-products-purchases.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { addStockSchema } from "@/lib/validators/validators";

const read = (path: string) => readFileSync(path, "utf8");

describe("purchase by-product input", () => {
  it("defaults to not tracked so old callers keep working", () => {
    const parsed = addStockSchema.parse({
      warehouseId: "w", materialType: "chemical", materialId: "m", quantity: "100", supplierId: "s", cost: "10",
      notes: "", paymentMethod: "", walletId: "", paymentStatus: "unpaid", amountPaid: "", transactionId: "", bankName: "",
    });
    expect(parsed.byProductTracked).toBe(false);
    expect(parsed.containerName).toBe("");
    expect(parsed.containerSize).toBe("");
  });

  it.each([
    "src/server-functions/inventory/stock/add-stock-fn.ts",
    "src/server-functions/inventory/add-chemical-fn.ts",
    "src/server-functions/inventory/add-packaging-material-fn.ts",
  ])("%s saves the by-product columns on the purchase", (path) => {
    expect(read(path)).toContain("...byProductColumns(data, ");
  });

  it("edit re-checks containers and guards sold vs earned", () => {
    const s = read("src/server-functions/suppliers/update-purchase-record-fn.ts");
    expect(s).toContain("byProductColumns(");
    expect(s).toContain("await assertEarnedCoversSold(tx, ref, byProductsBefore)");
  });

  it("void guards sold vs earned before material cleanup", () => {
    const s = read("src/server-functions/suppliers/delete-purchase-record-fn.ts");
    const guard = s.indexOf("await assertEarnedCoversSold(tx,");
    expect(guard).toBeGreaterThan(s.indexOf(".delete(purchaseRecords)"));
    expect(guard).toBeLessThan(s.indexOf("cleanupOrphanedMaterial(tx"));
  });
});
