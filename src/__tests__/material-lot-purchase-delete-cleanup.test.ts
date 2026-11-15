import { describe, expect, it, vi } from "vitest";
import { moveLotStock } from "@/lib/inventory/material-lots.server";

describe("moveLotStock purchase_delete cleanup", () => {
  it("deletes the materialStock row when a purchase deletion reduces stock to 0", async () => {
    const deletedQueries: any[] = [];
    const updatedQueries: any[] = [];
    const insertedQueries: any[] = [];

    const tx: any = {
      update: vi.fn((table: any) => {
        const builder: any = {
          set: vi.fn(() => builder),
          where: vi.fn(() => builder),
          returning: vi.fn((fields: any) => {
            updatedQueries.push({ table, fields });
            // If updating materialStock, return 0 quantity
            if (fields.quantity) {
              return Promise.resolve([{ id: "stock-1", quantity: "0.000" }]);
            }
            // If updating materialLotStock
            return Promise.resolve([{ id: "lot-stock-1" }]);
          }),
        };
        return builder;
      }),
      delete: vi.fn((table: any) => {
        const builder: any = {
          where: vi.fn((cond: any) => {
            deletedQueries.push({ table, cond });
            return Promise.resolve();
          }),
        };
        return builder;
      }),
      insert: vi.fn((table: any) => {
        const builder: any = {
          values: vi.fn((vals: any) => {
            insertedQueries.push({ table, vals });
            return Promise.resolve();
          }),
        };
        return builder;
      }),
    };

    await moveLotStock(tx, {
      ref: { materialType: "chemical", materialId: "chem-1" },
      lotId: "lot-1",
      warehouseId: "wh-1",
      delta: "-10.000",
      sourceType: "purchase_delete",
      sourceId: "purchase-1",
    });

    // Check that materialStock was deleted
    expect(tx.delete).toHaveBeenCalledTimes(1);
    expect(deletedQueries.length).toBe(1);
  });

  it("does not delete the materialStock row when remaining stock is greater than 0", async () => {
    const tx: any = {
      update: vi.fn((table: any) => {
        const builder: any = {
          set: vi.fn(() => builder),
          where: vi.fn(() => builder),
          returning: vi.fn((fields: any) => {
            if (fields.quantity) {
              return Promise.resolve([{ id: "stock-1", quantity: "20.000" }]);
            }
            return Promise.resolve([{ id: "lot-stock-1" }]);
          }),
        };
        return builder;
      }),
      delete: vi.fn(),
      insert: vi.fn(() => ({
        values: vi.fn(() => Promise.resolve()),
      })),
    };

    await moveLotStock(tx, {
      ref: { materialType: "chemical", materialId: "chem-1" },
      lotId: "lot-1",
      warehouseId: "wh-1",
      delta: "-10.000",
      sourceType: "purchase_delete",
      sourceId: "purchase-1",
    });

    // Should NOT delete materialStock because quantity is 20.000
    expect(tx.delete).not.toHaveBeenCalled();
  });
});
