import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvoiceItemsSection } from "@/components/sales/create-invoice-form/invoice-items-section";
import {
  blankItem,
  getDisplayedLineRate,
  getLiveUnitCostPerPack,
  resolvePerCartonPriceFromInput,
  type ItemFormValue,
  type StockItem,
} from "@/components/sales/create-invoice-form/utils";

const SelectContext = React.createContext<{
  value?: string;
  onValueChange?: (value: string) => void;
}>({});

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <SelectContext.Provider value={{ value, onValueChange }}>
      <div>{children}</div>
    </SelectContext.Provider>
  ),
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => null,
  SelectItem: ({ value, disabled, children }: any) => {
    const ctx = React.useContext(SelectContext);
    return (
      <button
        type="button"
        role="option"
        aria-selected={ctx.value === value}
        disabled={Boolean(disabled)}
        onClick={() => !disabled && ctx.onValueChange?.(value)}
      >
        {children}
      </button>
    );
  },
}));

afterEach(cleanup);

function showStock(
  stocks: StockItem[],
  infoFor: (recipeId: string) => { completeCartons: number; partialCartons: number; totalPacks: number },
  items: ItemFormValue[],
  extraProps: Record<string, any> = {},
) {
  const valueAt = (name: string) => {
    if (name === "items") return items;
    const [, index, key] = name.match(/^items\[(\d+)\]\.(.+)$/) ?? [];
    return items[Number(index)]?.[key as keyof ItemFormValue] ?? "";
  };
  const setFieldValue = vi.fn();
  const form = {
    getFieldValue: valueAt,
    setFieldValue,
    Field: ({ name, children }: any) =>
      children({
        state: { value: valueAt(name), meta: { errors: [], isTouched: false } },
        handleChange: vi.fn(),
        pushValue: vi.fn(),
        removeValue: vi.fn(),
      }),
  };
  render(
    <InvoiceItemsSection
      form={form}
      items={items}
      availableStock={stocks}
      activeWarehouse="floor"
      totalAmount={0}
      getCartonInfo={infoFor}
      handleFocus={vi.fn()}
      {...extraProps}
    />,
  );
  return { form, setFieldValue };
}

function show(stock: StockItem, info: { completeCartons: number; partialCartons: number; totalPacks: number }, items: ItemFormValue[]) {
  return showStock([stock], () => info, items);
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

  it("keeps the product selectable as loose packs without offering a full carton after another unit line reserves its packs", () => {
    show(stock, { completeCartons: 1, partialCartons: 1, totalPacks: 6 }, [item("recipe", 3), { ...blankItem(), unitType: "carton" }]);
    // Line 0 still has 1C avail; line 1 now sees the remaining 3 loose units instead of 1C.
    expect(screen.getAllByRole("option", { name: /Available product/ })).toHaveLength(4);
    expect(screen.getAllByText("1C avail")).toHaveLength(1);
    expect(screen.getAllByText("3U avail")).toHaveLength(1);
  });

  it("shows both carton and loose products when line unitType defaults to carton", () => {
    const looseOnly: StockItem = {
      id: "loose-stock",
      recipeId: "loose-recipe",
      recipe: { name: "Loose Bucket", containersPerCarton: 0, cartonPackagingId: null },
      quantityCartons: 0,
      quantityContainers: 15,
    };
    showStock(
      [stock, looseOnly],
      (id) => (id === "recipe" ? { completeCartons: 1, partialCartons: 0, totalPacks: 4 } : { completeCartons: 0, partialCartons: 0, totalPacks: 0 }),
      [blankItem()],
    );
    expect(screen.getAllByRole("option", { name: /Available product/ })).toHaveLength(2);
    expect(screen.getAllByRole("option", { name: /Loose Bucket/ })).toHaveLength(2);
    expect(screen.getByText("1C avail")).toBeTruthy();
    expect(screen.getByText("15U avail")).toBeTruthy();
  });

  it("auto-switches unitType to units for loose-only or partial-only stock and initializes qty and pack size", () => {
    const looseOnly: StockItem = {
      id: "loose-stock",
      recipeId: "loose-recipe",
      recipe: { name: "Loose Bucket", containersPerCarton: 0, cartonPackagingId: null },
      quantityCartons: 0,
      quantityContainers: 15,
    };
    const { setFieldValue } = showStock([looseOnly], () => ({ completeCartons: 0, partialCartons: 0, totalPacks: 0 }), [blankItem()]);
    fireEvent.click(screen.getAllByRole("option", { name: /Loose Bucket/ })[0]);

    expect(setFieldValue).toHaveBeenCalledWith("items[0].unitType", "units");
    expect(setFieldValue).toHaveBeenCalledWith("items[0].numberOfCartons", 0);
    expect(setFieldValue).toHaveBeenCalledWith("items[0].discountCartons", 0);
    expect(setFieldValue).toHaveBeenCalledWith("items[0].numberOfUnits", 1);
    expect(setFieldValue).toHaveBeenCalledWith("items[0].packsPerCarton", 1);
  });

  it("auto-switches unitType back to carton when selecting a carton-packaged product on a loose line", () => {
    const { setFieldValue } = showStock(
      [stock],
      () => ({ completeCartons: 2, partialCartons: 0, totalPacks: 8 }),
      [{ ...blankItem(), unitType: "units", numberOfCartons: 0, numberOfUnits: 0 }],
    );
    fireEvent.click(screen.getAllByRole("option", { name: /Available product/ })[0]);

    expect(setFieldValue).toHaveBeenCalledWith("items[0].unitType", "carton");
    expect(setFieldValue).toHaveBeenCalledWith("items[0].numberOfUnits", 0);
    expect(setFieldValue).toHaveBeenCalledWith("items[0].numberOfCartons", 1);
    expect(setFieldValue).toHaveBeenCalledWith("items[0].packsPerCarton", 4);
  });

  it("updates the rate header and unit-rate input conversion when rows are loose or mixed", () => {
    const { setFieldValue } = showStock(
      [stock],
      () => ({ completeCartons: 1, partialCartons: 1, totalPacks: 6 }),
      [{ ...item("recipe", 3), perCartonPrice: 40 }],
    );
    expect(screen.getAllByText("Unit Rate")).toHaveLength(2);
    expect(screen.queryByText("Carton Rate")).toBeNull();

    const unitRateInput = screen.getAllByLabelText("Price per unit")[0] as HTMLInputElement;
    expect(Number(unitRateInput.value)).toBe(10);

    fireEvent.change(unitRateInput, { target: { value: "12.5" } });
    expect(setFieldValue).toHaveBeenCalledWith("items[0].isPriceOverride", true);
    expect(getDisplayedLineRate(300, "units", 24)).toBe(12.5);
    expect(resolvePerCartonPriceFromInput(12.5, "units", 24)).toBe(300);

    cleanup();
    showStock(
      [stock],
      () => ({ completeCartons: 2, partialCartons: 0, totalPacks: 8 }),
      [{ ...blankItem(), recipeId: "recipe" }, item("recipe", 2)],
    );
    expect(screen.getByText("Rate")).toBeTruthy();
    expect(screen.getByText("/ctn")).toBeTruthy();
    expect(screen.getByText("/u")).toBeTruthy();
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
