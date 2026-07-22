import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  estimateLineProfit,
  lineAmount,
  roundMoney,
  getLiveUnitCostPerPack,
  getPreviewEffectiveCartonPrice,
  getPreviewPerCartonPrice,
  getLineUnitCostPerPack,
} from "@/components/sales/create-invoice-form/utils";
import {
  calculateInvoiceLinePricing,
  calculateLineAmount,
} from "@/lib/sales/invoice-line-pricing";

const CREATE_FORM_UTILS = resolve(
  process.cwd(),
  "src/components/sales/create-invoice-form/utils.tsx",
);
const ITEMS_SECTION = resolve(
  process.cwd(),
  "src/components/sales/create-invoice-form/invoice-items-section.tsx",
);
const CREATE_FORM = resolve(
  process.cwd(),
  "src/components/sales/create-invoice-form.tsx",
);
const SETTLEMENT_SECTION = resolve(
  process.cwd(),
  "src/components/sales/create-invoice-form/settlement-section.tsx",
);
const DETAIL_SHEET = resolve(
  process.cwd(),
  "src/components/sales/invoice-detail-sheet.tsx",
);
const INVOICES_FN = resolve(
  process.cwd(),
  "src/server-functions/sales/invoices-fn.ts",
);
const PRINT_DIALOG = resolve(
  process.cwd(),
  "src/components/sales/invoice-print-dialog.tsx",
);
const CONFIGURATIONS_ROUTE = resolve(
  process.cwd(),
  "src/routes/_protected/sales/configurations/index.tsx",
);
const INVOICE_TYPE_BADGE = resolve(
  process.cwd(),
  "src/components/sales/invoice-type-badge.tsx",
);
const NEW_INVOICE_ROUTE = resolve(
  process.cwd(),
  "src/routes/_protected/sales/new-invoice/index.tsx",
);

describe("invoice create/edit regressions", () => {
  it("computes carton-line profit from canonical base carton revenue minus unit cost", () => {
    const profit = estimateLineProfit(
      {
        pack: "Rs.100 Pack",
        recipeId: "recipe-1",
        unitType: "carton",
        numberOfCartons: 10,
        numberOfUnits: 0,
        discountCartons: 0,
        packsPerCarton: 24,
        hsnCode: "HSN",
        perCartonPrice: 396.24,
        retailPrice: 20.51,
        isPriceOverride: false,
      },
      24,
      12.51,
    );

    expect(profit).toBeCloseTo(960, 2);
  });

  it("uses configured recipe rates for live invoice pricing while keeping stock WAC for COGS", () => {
    const stock = {
      id: "fg-1",
      recipeId: "recipe-1",
      weightedAverageCostPerPack: "16.92",
      recipe: {
        productId: "product-1",
        containersPerCarton: 24,
        estimatedCostPerContainer: "16.50",
      },
    };

    expect(
      getLiveUnitCostPerPack(stock as any, {
        invoicePricePerPack: 16.5,
        retailPricePerPack: 20.5,
      }),
    ).toBe(16.92);

    expect(
      getPreviewPerCartonPrice(
        stock as any,
        { invoicePricePerPack: 16.5, retailPricePerPack: 20.5 },
        0,
        false,
      ),
    ).toBeCloseTo(396, 2);

    expect(
      getPreviewPerCartonPrice(
        stock as any,
        undefined,
        0,
        false,
      ),
    ).toBe(0);
  });

  it("reduces distributor carton rate by the configured margin instead of increasing it", () => {
    expect(
      getPreviewEffectiveCartonPrice(
        396,
        10,
        true,
      ),
    ).toBeCloseTo(356.4, 2);
  });

  it("uses stock WAC for profit preview unless operator manually overrides unit cost", () => {
    const stock = {
      id: "fg-1",
      recipeId: "recipe-1",
      weightedAverageCostPerPack: "16.92",
      recipe: {
        productId: "product-1",
        containersPerCarton: 24,
      },
    };

    expect(
      getLineUnitCostPerPack(
        {
          pack: "Rs.100 Pack",
          recipeId: "recipe-1",
          unitType: "carton",
          numberOfCartons: 10,
          numberOfUnits: 0,
          discountCartons: 0,
          packsPerCarton: 24,
          hsnCode: "HSN",
          perCartonPrice: 0,
          retailPrice: 20.51,
          isPriceOverride: false,
        },
        stock as any,
        { invoicePricePerPack: 16.5, retailPricePerPack: 20.5 },
      ),
    ).toBe(16.92);

    expect(
      getLineUnitCostPerPack(
        {
          pack: "Rs.100 Pack",
          recipeId: "recipe-1",
          unitType: "carton",
          numberOfCartons: 10,
          numberOfUnits: 0,
          discountCartons: 0,
          packsPerCarton: 24,
          hsnCode: "HSN",
          perCartonPrice: 396,
          retailPrice: 20.51,
          isPriceOverride: true,
        },
        stock as any,
        { invoicePricePerPack: 16.5, retailPricePerPack: 20.5 },
      ),
    ).toBe(16.5);
  });

  it("bills distributor carton lines from carton rate, not reference MRP", () => {
    expect(
      calculateLineAmount({
        unitType: "carton",
        numberOfCartons: 1,
        numberOfUnits: 0,
        perCartonPrice: 446.69,
        retailPrice: 20.51,
        containersPerCarton: 24,
        pricingMode: "distributor",
      }),
    ).toBe(446.69);
  });

  it("computes canonical distributor gross, deductions, net, and profit from base carton rate", () => {
    const pricing = calculateInvoiceLinePricing({
      invoiceMode: "distributor",
      unitType: "carton",
      numberOfCartons: 26,
      numberOfUnits: 0,
      manualFreeCartons: 0,
      autoFreeCartons: 2,
      baseCartonRate: 2208,
      containersPerCarton: 24,
      defaultMarginPercent: 8,
      unitCostPerPack: 16.92,
    });

    expect(pricing.effectiveCartonRate).toBe(2031.36);
    expect(pricing.grossAmount).toBe(57408);
    expect(pricing.marginDeduction).toBe(4592.64);
    expect(pricing.schemeDeduction).toBe(4062.72);
    expect(pricing.netAmount).toBe(48752.64);
    expect(pricing.dispatchedUnits).toBe(672);
    expect(pricing.costOfGoodsSold).toBe(11370.24);
    expect(pricing.profit).toBe(37382.4);
    expect(roundMoney(pricing.grossAmount - pricing.marginDeduction - pricing.schemeDeduction)).toBe(pricing.netAmount);
  });

  it("treats scheme cartons as extra dispatched stock on top of ordered cartons", () => {
    const pricing = calculateInvoiceLinePricing({
      invoiceMode: "distributor",
      unitType: "carton",
      numberOfCartons: 100,
      numberOfUnits: 0,
      manualFreeCartons: 0,
      autoFreeCartons: 2,
      baseCartonRate: 500,
      containersPerCarton: 24,
      defaultMarginPercent: 10,
      unitCostPerPack: 16.92,
    });

    expect(pricing.grossAmount).toBe(50000);
    expect(pricing.netAmount).toBe(44100);
    expect(pricing.dispatchedUnits).toBe(2448);
    expect(pricing.costOfGoodsSold).toBe(41420.16);
    expect(pricing.profit).toBe(2679.84);
  });

  it("computes canonical general-invoice carton lines from the base carton rate", () => {
    const pricing = calculateInvoiceLinePricing({
      invoiceMode: "general",
      unitType: "carton",
      numberOfCartons: 2,
      numberOfUnits: 0,
      manualFreeCartons: 0,
      autoFreeCartons: 0,
      baseCartonRate: 450,
      containersPerCarton: 24,
      unitCostPerPack: 16.92,
    });

    expect(pricing.baseCartonRate).toBe(450);
    expect(pricing.effectiveCartonRate).toBe(450);
    expect(pricing.grossAmount).toBe(900);
    expect(pricing.netAmount).toBe(900);
    expect(pricing.costOfGoodsSold).toBe(812.16);
    expect(pricing.profit).toBe(87.84);
  });

  it("computes canonical general-invoice loose-unit pricing from carton rates", () => {
    const pricing = calculateInvoiceLinePricing({
      invoiceMode: "general",
      unitType: "units",
      numberOfCartons: 0,
      numberOfUnits: 5,
      manualFreeCartons: 0,
      autoFreeCartons: 0,
      baseCartonRate: 240,
      containersPerCarton: 24,
      unitCostPerPack: 8,
    });

    expect(pricing.baseUnitRate).toBe(10);
    expect(pricing.effectiveUnitRate).toBe(10);
    expect(pricing.grossAmount).toBe(50);
    expect(pricing.netAmount).toBe(50);
    expect(pricing.costOfGoodsSold).toBe(40);
    expect(pricing.profit).toBe(10);
  });

  it("prices general-invoice preview from base carton rate even when legacy MRP exists", () => {
    expect(
      lineAmount(
        {
          pack: "Legacy General Line",
          recipeId: "recipe-1",
          unitType: "carton",
          numberOfCartons: 2,
          numberOfUnits: 0,
          discountCartons: 0,
          packsPerCarton: 24,
          hsnCode: "HSN",
          perCartonPrice: 450,
          retailPrice: 30,
          isPriceOverride: false,
        },
        24,
        "retailer",
      ),
    ).toBe(900);
  });

  it("preserves stored distributor sell rate during edit preview instead of reapplying margin", () => {
    expect(
      lineAmount(
        {
          pack: "Legacy Distributor Line",
          recipeId: "recipe-1",
          unitType: "carton",
          numberOfCartons: 5,
          numberOfUnits: 0,
          discountCartons: 0,
          packsPerCarton: 24,
          hsnCode: "HSN",
          perCartonPrice: 2031.36,
          retailPrice: 0,
          isPriceOverride: false,
          preserveStoredDistributorRate: true,
        },
        24,
        "distributor",
        0,
        8,
      ),
    ).toBeCloseTo(10156.8, 2);
  });

  it("subtracts distributor scheme cartons from the billed carton count", () => {
    expect(
      calculateLineAmount({
        unitType: "carton",
        numberOfCartons: 26,
        numberOfUnits: 0,
        discountCartons: 0,
        freeCartons: 2,
        perCartonPrice: 2031.36,
        retailPrice: 0,
        containersPerCarton: 24,
        pricingMode: "distributor",
      }),
    ).toBe(48752.64);
  });

  it("keeps distributor profit cost on live stock cost even when carton rate is manually overridden", () => {
    const stock = {
      id: "fg-1",
      recipeId: "recipe-1",
      weightedAverageCostPerPack: "16.92",
      recipe: {
        productId: "product-1",
        containersPerCarton: 24,
      },
    };

    expect(
      getLineUnitCostPerPack(
        {
          pack: "Rs.100 Pack",
          recipeId: "recipe-1",
          unitType: "carton",
          numberOfCartons: 1,
          numberOfUnits: 0,
          discountCartons: 0,
          packsPerCarton: 24,
          hsnCode: "HSN",
          perCartonPrice: 446.69,
          retailPrice: 20.51,
          isPriceOverride: true,
        },
        stock as any,
        { invoicePricePerPack: 16.5, retailPricePerPack: 20.5 },
        "distributor",
      ),
    ).toBe(16.92);
  });

  it("rounds payable money totals to 2 decimals before writing them into form state", () => {
    expect(roundMoney(4922.4 + 100)).toBe(5022.4);
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(499.999)).toBe(500);
  });

  it("formats PKR values with 2 decimals in the create/edit form", () => {
    const source = readFileSync(CREATE_FORM_UTILS, "utf8");

    expect(source).toContain("decimals = 2");
    expect(source).not.toContain('from "@/server-functions/sales/invoices-fn"');
  });

  it("keeps invoice print dialog on the lightweight detail server function", () => {
    const source = readFileSync(PRINT_DIALOG, "utf8");

    expect(source).toContain('from "@/server-functions/sales/invoice-detail-fn"');
    expect(source).not.toContain('from "@/server-functions/sales/invoices-fn"');
    expect(source).toContain("getInvoiceDetailFn({ data: { invoiceId } })");
    expect(source).toContain("const invoice = invoiceEnvelope?.invoice ?? null;");
  });

  it("preserves decimal carton prices and marks manual edits as overrides", () => {
    const source = readFileSync(ITEMS_SECTION, "utf8");

    expect(source).toContain("getPreviewPerCartonPrice(");
    expect(source).toContain("getCartonRateHoverLines({");
    expect(source).toContain("Carton rate pricing details");
    expect(source).toContain('"Gross Amount"');
    expect(source).toContain('"Net Amount"');
    expect(source).not.toContain('MRP (Ref)');
    expect(source).not.toContain("Math.round(rp.invoicePricePerPack * cpp)");
    expect(source).toContain("isPriceOverride`, true");
    expect(source).toContain("isPriceOverride`, false");
  });

  it("reduces carton availability by quantities already selected on other lines", () => {
    const source = readFileSync(ITEMS_SECTION, "utf8");

    expect(source).toContain("getReservedCartonsForRecipe");
    expect(source).toContain("currentItem.numberOfCartons || 0) + autoFreeCartons + manualFreeCartons");
    expect(source).toContain("remainingCompleteCartons");
    expect(source).toContain("(rawCartonInfo.completeCartons || 0) - otherReservedCartons");
    expect(source).not.toContain("form.setFieldValue(`items[${index}].discountCartons`, autoFreeCartons);");
  });

  it("keeps edit-mode warehouse selection from being overwritten by first warehouse and resets mobile qty fields on unit-type switch", () => {
    const formSource = readFileSync(CREATE_FORM, "utf8");
    const itemsSource = readFileSync(ITEMS_SECTION, "utf8");

    expect(formSource).toContain("const resolvedInitialWarehouseId = initialData?.warehouseId || warehouses[0]?.id || \"\";");
    expect(formSource).toContain("useState<string>(resolvedInitialWarehouseId)");
    expect(formSource).toContain("form.setFieldValue(\"warehouseId\", activeWarehouse);");
    expect(itemsSource).toContain("form.setFieldValue(`items[${index}].numberOfUnits`, 0);");
    expect(itemsSource).toContain("form.setFieldValue(`items[${index}].numberOfCartons`, 0);");
    expect(itemsSource).toContain("form.setFieldValue(`items[${index}].discountCartons`, 0);");
    expect(itemsSource).toContain("Manual free cartons dispatched on top of the entered quantity and not billed");
  });

  it("shows invoice profit from canonical line pricing in create/edit flow", () => {
    const source = readFileSync(CREATE_FORM, "utf8");
    const utilsSource = readFileSync(CREATE_FORM_UTILS, "utf8");

    expect(source).toContain("getLineUnitCostPerPack(item, stock, recipePricing, pricingMode)");
    expect(source).toContain("getLinePricingBreakdown(");
    expect(source).toContain("marginPercent");
    expect(source).toContain("const isDistributorInvoice = values.customerType === \"distributor\"");
    expect(source).toContain("invoiceDiscount");
    expect(source).toContain("const appliedDiscount = Math.min(invoiceDiscount, totalAmount)");
    expect(source).toContain("roundMoney((totalAmount - appliedDiscount) + expenses)");
    expect(source).toContain("roundMoney(Math.max(0, totalPayable - cashPaid))");
    expect(source).toContain("const totalPayable = roundMoney(grossPayable);");
    expect(source).not.toContain("computeProfit(items, availableStock) - expenses");
    expect(source).toContain("totalProfit={totalProfit}");
    expect(utilsSource).toContain("baseCartonRate: item.perCartonPrice || 0");
  });

  it("lets settlement amount fields accept paisa values and keeps retailer discount UI separate", () => {
    const source = readFileSync(SETTLEMENT_SECTION, "utf8");

    expect(source).toContain('step="0.01"');
    expect(source).toContain('form.setFieldValue("cash", Number(totalPayable.toFixed(2)))');
    expect(source).toContain("FieldLabel>Discount<");
    expect(source).toContain("General-invoice discount.");
    expect(source).toContain("const roundedTotalProfit = Math.round(totalProfit);");
    expect(source).toContain("{PKR(roundedTotalProfit)}");
    expect(source).not.toContain("automaticRoundOff");
    expect(source).not.toContain("rounded down automatically");
    expect(source).not.toContain("Round Off Decimal");
    expect(source).not.toContain("Use Cash Difference As Discount");
  });

  it("shows invoice expense in summary only without reducing displayed profit", () => {
    const source = readFileSync(DETAIL_SHEET, "utf8");

    expect(source).toContain('uppercase">Invoice Expense<');
    expect(source).toContain('uppercase">Sale Quantity<');
    expect(source).toContain('uppercase">Discount<');
    expect(source).toContain("const invoiceDiscount = Number(invoice.invoiceDiscount) || 0;");
    expect(source).toContain("const roundedDisplayProfit = Math.round(totalProfit);");
    expect(source).toContain("const invoiceSaleSummary = buildInvoiceSaleSummary(invoice.items ?? []);");
    expect(source).toContain('TableHead className="text-[11px] text-right">Dispatched Units</TableHead>');
    expect(source).toContain('TableHead className="text-[11px] text-right">Gross Amount</TableHead>');
    expect(source).toContain('TableHead className="text-[11px] text-right">Net Amount</TableHead>');
    expect(source).toContain("const grossItemsTotal = roundMoney(");
    expect(source).toContain("const netItemsTotal = roundMoney(");
    expect(source).toContain("const getLineGrossAmount = (item: any) => {");
    expect(source).toContain("const totalProfit = roundMoney(totalProfitBeforeDiscount - invoiceDiscount);");
    expect(source).toContain("{PKR(roundedDisplayProfit)}");
    expect(source).toContain("Number(item.costOfGoodsSold) > 0");
    expect(source).not.toContain("const totalProfit = totalProfitBeforeExpenses - expenses;");
    expect(source).not.toContain("TableHead className=\"text-[11px] text-right\">Amount</TableHead>");
  });

  it("resolves invoice base rates from distributor, order-booker, general, and global sources in the form flow", () => {
    const source = readFileSync(CREATE_FORM, "utf8");
    const itemsSectionSource = readFileSync(ITEMS_SECTION, "utf8");
    const routeSource = readFileSync(NEW_INVOICE_ROUTE, "utf8");
    const configSource = readFileSync(CONFIGURATIONS_ROUTE, "utf8");

    expect(source).toContain('useGetRecipeRatesForEntity(');
    expect(source).toContain('"distributor"');
    expect(source).toContain('"order_booker"');
    expect(source).toContain('"general"');
    expect(source).toContain('baseRateLabel: "Global recipe rate"');
    expect(source).toContain('baseRateLabel: "General walk-in recipe rate"');
    expect(source).toContain('baseRateLabel: "Distributor recipe rate"');
    expect(source).toContain('baseRateLabel: "Order-booker recipe rate"');
    expect(source).toContain("preserveOrderLineRate={isOrderConversionContext}");
    expect(source).toContain("preserveStoredDistributorRate");
    expect(source).toContain("legacyBaseCartonRate");
    expect(source).toContain("deriveLegacyDistributorPricingState");
    expect(source).toContain("function normalizeInvoiceCustomerType(");
    expect(source).toContain('if (rawCustomerType === "wholesaler") return "wholesaler";');
    expect(source).toContain("const existing = map.get(rule.recipeId) ?? [];");
    expect(itemsSectionSource).toContain("const shouldPreserveExistingOrderRate =");
    expect(itemsSectionSource).not.toContain('baseRateSource === "global_recipe_rate"');
    expect(itemsSectionSource).toContain('"Order line rate"');
    expect(itemsSectionSource).toContain('"Stored invoice rate"');
    expect(itemsSectionSource).toContain("getApplicableDistributorFreeCartons({");
    expect(routeSource).toContain("orderBookerId: od.order.orderBookerId");
    expect(routeSource).toContain("function getBookedOrderUnitMeta");
    expect(routeSource).toContain("normalizeBookedOrderUnitType");
    expect(routeSource).toContain('normalizedUnitType === "fullcarton"');
    expect(routeSource).toContain('normalizedUnitType === "half carton"');
    expect(routeSource).toContain("if (it.hasCartonPackaging)");
    expect(routeSource).toContain("perCartonPrice: roundMoney(orderRate * 2)");
    expect(routeSource).toContain("perCartonPrice: hasCartonPackaging");
    expect(routeSource).toContain("orderPreview:");
    expect(routeSource).toContain("unitLabel: getBookedOrderUnitMeta(it).label");
    expect(source).toContain("Booked Order Preview");
    expect(source).toContain("These booked-order values are preloaded into the invoice editor below");
    expect(configSource).toContain('SelectItem value="general">General / Walk-in</SelectItem>');
    expect(configSource).toContain("GENERAL_RECIPE_RATE_ENTITY_ID");
  });

  it("uses general invoice wording in visible invoice UI labels", () => {
    const badgeSource = readFileSync(INVOICE_TYPE_BADGE, "utf8");
    const routeSource = readFileSync(NEW_INVOICE_ROUTE, "utf8");
    const printSource = readFileSync(PRINT_DIALOG, "utf8");

    expect(badgeSource).toContain('retailer: "General Invoice"');
    expect(badgeSource).toContain('shopkeeper: "General Invoice"');
    expect(badgeSource).toContain('wholesaler: "General Invoice"');
    expect(routeSource).toContain("New General Invoice");
    expect(printSource).toContain("General");
  });

  it("rounds invoice profit consistently in print and detail views", () => {
    const detailSource = readFileSync(DETAIL_SHEET, "utf8");
    const printSource = readFileSync(PRINT_DIALOG, "utf8");

    expect(detailSource).toContain("const totalProfitBeforeDiscount = roundMoney((invoice.items ?? []).reduce(");
    expect(detailSource).toContain("const totalProfit = roundMoney(totalProfitBeforeDiscount - invoiceDiscount);");
    expect(printSource).toContain("const roundMoney = (value: number) => Math.round(value * 100) / 100;");
    expect(printSource).toContain("return roundMoney((items ?? []).reduce(");
    expect(printSource).toContain("totalProfit: Math.round(calculateInvoiceProfit(inv.items))");
    expect(printSource).toContain("grossAmount: billedCartons > 0");
  });

  it("stores distributor invoice lines with real carton math and pack metadata on save", () => {
    const source = readFileSync(INVOICES_FN, "utf8");

    expect(source).toContain("pricingMode === \"distributor\"");
    expect(source).toContain("const resolveCanonicalInvoiceLine = ({");
    expect(source).toContain("const pricingBreakdown = calculateInvoiceLinePricing({");
    expect(source).toContain("discountCartons: r.manualDiscountCartons");
    expect(source).toContain("freeCartons: r.discountFreeCartons");
    expect(source).toContain("requestedUnits: pricingBreakdown.dispatchedUnits");
    expect(source).toContain("chargedUnits: r.chargedUnits");
    expect(source).toContain("dispatchedUnits: r.totalDispatchedUnits");
    expect(source).toContain("fillAmountSnapshot: r.fillAmountSnapshot.toFixed(3)");
    expect(source).toContain("fillUnitSnapshot: r.fillUnitSnapshot");
    expect(source).toContain("stockWarehouseId");
    expect(source).toContain("const factoryFloorWarehouse = await resolveFactoryFloorWarehouse(tx);");
    expect(source).toContain("packsPerCarton: r.containersPerCarton");
    expect(source).toContain("perCartonPrice: r.pricingBreakdown.baseCartonRate.toString()");
    expect(source).toContain("amount: r.pricingBreakdown.netAmount.toString()");
    expect(source).toContain("costOfGoodsSold: r.cogsTotal.toFixed(2)");
    expect(source).toContain("costOfGoodsSoldPerUnit: r.cogsPerUnit.toFixed(4)");
    expect(source).toContain("grossAmount: r.pricingBreakdown.grossAmount");
    expect(source).toContain("effectiveCartonRate: r.pricingBreakdown.effectiveCartonRate");
  });
});
