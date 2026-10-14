import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvoiceItemsSection } from "@/components/sales/create-invoice-form/invoice-items-section";
import { blankItem, getLiveUnitCostPerPack, type ItemFormValue, type StockItem } from "@/components/sales/create-invoice-form/utils";

vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectItem: ({ children }: any) => <div role="option">{children}</div>,
}));

afterEach(cleanup);

function show(stock: StockItem, info: { completeCartons: number; partialCartons: number; totalPacks: number }, items: ItemFormValue[]) {
  const valueAt = (name: string) => {
    if (name === "items") return items;
    const [, index, key] = name.match(/^items\[(\d+)\]\.(.+)$/) ?? [];
    return items[Number(index)]?.[key as keyof ItemFormValue] ?? "";
  };
  const form = {
    getFieldValue: valueAt,
    setFieldValue: vi.fn(),
    Field: ({ name, children }: any) => children({ state: { value: valueAt(name), meta: { errors: [] } }, handleChange: vi.fn(), pushValue: vi.fn(), removeValue: vi.fn() }),
  };
  render(<InvoiceItemsSection form={form} items={items} availableStock={[stock]} activeWarehouse="floor" totalAmount={0} getCartonInfo={() => info} handleFocus={vi.fn()} />);
}

const stock: StockItem = { id: "stock", recipeId: "recipe", recipe: { name: "Available product", containersPerCarton: 4 }, quantityCartons: 1, quantityContainers: 2, weightedAverageCostPerPack: "1" };
const item = (recipeId = "recipe", units = 0): ItemFormValue => ({ ...blankItem(), recipeId, unitType: "units", numberOfUnits: units });

describe("invoice stock availability", () => {
  it("counts the full and partial carton fixture as six packs instead of eight", () => {
    show(stock, { completeCartons: 1, partialCartons: 1, totalPacks: 6 }, [item("recipe", 7)]);
    expect(screen.getByText("Exceeds stock")).toBeTruthy();
  });

  it.each(["partial", "loose"])("offers %s stock for unit lines on desktop and mobile", (kind) => {
    show({ ...stock, quantityCartons: 0, quantityContainers: kind === "partial" ? 2 : 7, recipe: { name: "Available product", containersPerCarton: kind === "partial" ? 4 : 0 } },
      { completeCartons: 0, partialCartons: kind === "partial" ? 1 : 0, totalPacks: kind === "partial" ? 2 : 0 }, [item("")]);
    expect(screen.getAllByRole("option", { name: /Available product/ })).toHaveLength(2);
  });

  it("does not offer a full carton after another unit line reserves its packs", () => {
    show(stock, { completeCartons: 1, partialCartons: 1, totalPacks: 6 }, [item("recipe", 3), { ...blankItem(), unitType: "carton" }]);
    // The unit line still has two product options; the carton line has none.
    expect(screen.getAllByRole("option", { name: /Available product/ })).toHaveLength(2);
  });

  it("excludes held packs and detects a sold-out selection", () => {
    show(stock, { completeCartons: 0, partialCartons: 0, totalPacks: 0 }, [item("recipe", 1)]);
    expect(screen.getByText("Exceeds stock")).toBeTruthy();
    expect(screen.queryAllByRole("option", { name: /Available product/ })).toHaveLength(0);
  });

  it("preserves a recorded zero WAC in the invoice profit preview", () => {
    expect(getLiveUnitCostPerPack({ ...stock, weightedAverageCostPerPack: "0", recipe: { ...stock.recipe, estimatedCostPerContainer: "5" } }, { invoicePricePerPack: 7, retailPricePerPack: 10 })).toBe(0);
  });
});
