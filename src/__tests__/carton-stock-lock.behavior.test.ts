import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ lockStock: vi.fn() }));
vi.mock("@/db", async () => ({ ...await import("@/db/schemas/manufacturing-schema"), db: {} }));
vi.mock("@/lib/cartons/stock-adjustment.server", () => ({ lockCartonStock: mocks.lockStock }));
import { findCartonByIdForUpdate, findCartonsByIdsForUpdate } from "@/lib/cartons/carton.repository";

function transaction(locked: { id: string; warehouseId: string; recipeId: string }) {
  const before = { id: "carton", warehouseId: "source", recipeId: "recipe" };
  let reads = 0;
  return { select: () => {
    const result = reads++ === 0 ? [before] : [locked];
    const query: any = { from: () => query, where: () => query, orderBy: () => query,
      for: () => Promise.resolve(result), then: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject) };
    return query;
  } };
}

describe("carton stock lock ownership", () => {
  it.each([
    { id: "carton", warehouseId: "destination", recipeId: "recipe" },
    { id: "carton", warehouseId: "source", recipeId: "other-recipe" },
  ])("rejects a changed stock location before the caller can mutate it: %j", async row => {
    await expect(findCartonsByIdsForUpdate(["carton"], transaction(row) as any)).rejects.toThrow(/moved|changed|retry/i);
  });
  it("returns the carton when its locked stock location still matches", async () => {
    const row = { id: "carton", warehouseId: "source", recipeId: "recipe" };
    expect(await findCartonsByIdsForUpdate(["carton"], transaction(row) as any)).toEqual([row]);
  });
  it("rejects a moved carton through the single-carton mutation path", async () => {
    await expect(findCartonByIdForUpdate("carton", transaction({ id: "carton", warehouseId: "destination", recipeId: "recipe" }) as any)).rejects.toThrow(/moved|changed|retry/i);
  });
});
