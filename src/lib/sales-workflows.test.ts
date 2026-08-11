import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SALES_FN_DIR = resolve(process.cwd(), "src/server-functions/sales");
const SALES_COMPONENTS_DIR = resolve(process.cwd(), "src/components/sales");
const SALES_MIGRATIONS_DIR = resolve(process.cwd(), "src/db/migrations");
const SALES_ORDER_BILL_FN = resolve(
  process.cwd(),
  "src/server-functions/sales/order-bill-number.ts",
);
const SALES_CUSTOMER_LEDGER_ROUTE = resolve(
  process.cwd(),
  "src/routes/_protected/sales/customers/$customerId/index.tsx",
);
const SALES_CONFIG_FN = resolve(
  process.cwd(),
  "src/server-functions/sales/sales-config-fn.ts",
);
const ORDER_PAD_DIALOG = resolve(
  process.cwd(),
  "src/components/sales/create-order-pad-dialog.tsx",
);

describe("sales workflow regressions", () => {
  it("joins invoices before filtering overdue slips by due date", () => {
    const source = readFileSync(
      resolve(SALES_FN_DIR, "overdue-detection-fn.ts"),
      "utf8",
    );

    expect(source).toContain(".innerJoin(invoices, eq(slipRecords.invoiceId, invoices.id))");
    expect(source).not.toContain("tx.query.slipRecords.findMany({\n        where: and(\n          ne(slipRecords.status, \"closed\"),\n          lt(invoices.creditReturnDate, todayStart),");
  });

  it("orders recovery attempts by the attempts table timestamp", () => {
    const source = readFileSync(
      resolve(SALES_FN_DIR, "invoice-detail-fn.ts"),
      "utf8",
    );

    expect(source).toContain("desc(creditRecoveryAttempts.attemptedAt)");
    expect(source).toContain("recoveryAttempts:");
    expect(source).not.toContain("recoveryAttempts: {\n            with: { assignedTo: { columns: { id: true, name: true } } },\n            orderBy: [desc(payments.paymentDate)],");
  });

  it("caps return quantities against prior reserved and approved returns without rewriting historical invoice totals", () => {
    const source = readFileSync(
      resolve(SALES_FN_DIR, "sales-returns-fn.ts"),
      "utf8",
    );

    expect(source).toContain("getReturnedUnitsByInvoiceItem");
    expect(source).toContain("[\"pending\", \"approved\"]");
    expect(source).toContain("[\"approved\"]");
    expect(source).toContain("remaining returnable quantity");
    expect(source).toContain("Invoice totals are intentionally NOT mutated here.");
    expect(source).not.toContain("status: deriveInvoiceStatus(currentInvoiceCash, nextInvoiceCredit)");
  });

  it("tracks duplicate invoice recipe lines cumulatively and keeps returns on per-unit sale pricing", () => {
    const invoiceSource = ["invoices-fn.ts", "invoice-posting-service.ts"]
      .map((fileName) => readFileSync(resolve(SALES_FN_DIR, fileName), "utf8"))
      .join("\n");
    const returnsSource = readFileSync(
      resolve(SALES_FN_DIR, "sales-returns-fn.ts"),
      "utf8",
    );

    expect(invoiceSource).toContain("const reservedUnitsByRecipe = new Map<string, number>()");
    expect(invoiceSource).toContain("const remainingUnitsByRecipe = new Map<string, number>()");
    expect(invoiceSource).toContain("if (lineResolution.totalDispatchedUnits > remainingAvailableUnits)");
    expect(invoiceSource).toContain("alreadyReservedUnits + lineResolution.totalDispatchedUnits");
    expect(invoiceSource).toContain("getSavedInvoiceItemDispatchedUnits");
    expect(invoiceSource).toContain("existing.stockWarehouseId ?? existing.warehouseId");
    expect(invoiceSource).toContain("invoice.stockWarehouseId ?? invoice.warehouseId");
    expect(returnsSource).toContain("const requestUnitsByItem = new Map<string, number>()");
    expect(returnsSource).toContain("Number(invoiceItem.retailPrice || 0)");
    expect(returnsSource).toContain("Number(invoiceItem.perCartonPrice) / cpp");
    expect(returnsSource).toMatch(
      /salesReturn\.invoice\.stockWarehouseId\s*\?\?\s*salesReturn\.invoice\.warehouseId/,
    );
    expect(returnsSource).toContain("Return quantity must be greater than zero");
  });

  it("validates invoice carton availability from carton ledger sellable counts while preserving physical stock totals", () => {
    const invoiceSource = ["invoices-fn.ts", "invoice-posting-service.ts"]
      .map((fileName) => readFileSync(resolve(SALES_FN_DIR, fileName), "utf8"))
      .join("\n");
    const invoiceItemsSource = readFileSync(
      resolve(
        SALES_COMPONENTS_DIR,
        "create-invoice-form/invoice-items-section.tsx",
      ),
      "utf8",
    );

    expect(invoiceSource).toContain("getCartonInventorySnapshot");
    expect(invoiceSource).toContain("sellableCompleteCartons");
    expect(invoiceSource).toContain("physicalTotalUnits");
    expect(invoiceSource).toContain("remainingUnitsByRecipe = new Map<string, number>()");
    expect(invoiceItemsSource).toContain("const sellableCartonPacks = rawCartonInfo.totalPacks || 0;");
    expect(invoiceItemsSource).toContain("const totalStockU = sellableCartonPacks + stockU;");
  });

  it("caps retailer discount at the server boundary and rounds payable totals to currency precision", () => {
    const invoiceSource = readFileSync(
      resolve(SALES_FN_DIR, "invoice-posting-service.ts"),
      "utf8",
    );

    expect(invoiceSource).toContain('customerType: true');
    expect(invoiceSource).toContain('const isRetailerInvoice = customerRecord?.customerType === "retailer"');
    expect(invoiceSource).toContain("if (invoiceDiscount > totalAmount)");
    expect(invoiceSource).toContain("const totalPayable = roundMoney(");
    expect(invoiceSource).toContain("netInvoiceAmount + Number(data.expenses ?? 0)");
    expect(invoiceSource).toContain("const settlementPreview = calculateSettlement(");
    expect(invoiceSource).toContain("assertSettlementDueDate(settlementPreview, data.paymentDueDate)");
    expect(invoiceSource).toContain("invoiceDiscount: invoiceDiscount.toString()");
    expect(invoiceSource).toContain("invoiceDiscountDescription: isRetailerInvoice");
    expect(invoiceSource).toContain("amount: netInvoiceAmount.toString()");
  });

  it("uses the shared date picker in recovery detail flow and keeps partial-payment amounts informational only", () => {
    const recoverySheetSource = readFileSync(
      resolve(SALES_COMPONENTS_DIR, "recovery/recovery-detail-sheet.tsx"),
      "utf8",
    );
    const recoveryFnSource = readFileSync(
      resolve(SALES_FN_DIR, "credit-recovery-fn.ts"),
      "utf8",
    );
    const recoveryHookSource = readFileSync(
      resolve(process.cwd(), "src/hooks/sales/use-credit-recovery.ts"),
      "utf8",
    );
    const attemptTimelineSource = readFileSync(
      resolve(SALES_COMPONENTS_DIR, "recovery/attempt-timeline.tsx"),
      "utf8",
    );

    expect(recoverySheetSource).toContain('from "@/components/custom/date-picker"');
    expect(recoverySheetSource).toContain("<DatePicker");
    expect(recoverySheetSource).toContain("Reconciliation &gt; Recovery Slip");
    expect(recoverySheetSource).toContain('newAttempt.attemptOutcome === "partial_payment"');
    expect(recoveryHookSource).toContain("promisedDate?: string");
    expect(recoveryFnSource).toContain("recoveryAssignedToId: z.string().min(1).optional()");
    expect(recoveryFnSource).toContain("recoveryAssignedToId: data.recoveryAssignedToId ?? null");
    expect(recoveryFnSource).toContain('data.attemptOutcome === "promised" && data.promisedDate');
    expect(attemptTimelineSource).toContain('a.attemptOutcome === "partial_payment"');
    expect(attemptTimelineSource).toContain("Recovery rep:");
    expect(attemptTimelineSource).not.toContain("Logged by");
  });

  it("normalizes booked-order recipe unit defaults before invoice conversion", () => {
    const ordersSource = readFileSync(
      resolve(SALES_FN_DIR, "orders-fn.ts"),
      "utf8",
    );
    const orderPadSource = readFileSync(ORDER_PAD_DIALOG, "utf8");

    expect(ordersSource).toContain("hasCartonPackaging:");
    expect(ordersSource).toContain("cartonPackagingId: true");
    expect(orderPadSource).toContain("function getDefaultOrderUnitType(");
    expect(orderPadSource).toContain("function getAllowedOrderUnitTypes(");
    expect(orderPadSource).toContain('return Number(containersPerCarton ?? 0) > 0 ? "carton" : "pack";');
    expect(orderPadSource).toContain('{ value: "half carton", label: "Half Carton" }');
    expect(orderPadSource).toContain('{ value: "pack", label: "Pack" }');
    expect(orderPadSource).toContain("selectedRecipe?: Pick<Recipe, \"containersPerCarton\">");
    expect(orderPadSource).toContain("getDefaultOrderUnitType(selectedRecipe?.containersPerCarton)");
    expect(orderPadSource).toContain("Select recipe first");
  });

  it("persists invoice items from one canonical pricing helper and audits base-vs-net semantics", () => {
    const invoiceSource = ["invoices-fn.ts", "invoice-posting-service.ts"]
      .map((fileName) => readFileSync(resolve(SALES_FN_DIR, fileName), "utf8"))
      .join("\n");

    expect(invoiceSource).toContain("const factoryFloorWarehouse = await resolveFactoryFloorWarehouse(tx);");
    expect(invoiceSource).toContain("stockWarehouseId");
    expect(invoiceSource).toContain("const resolveCanonicalInvoiceLine = ({");
    expect(invoiceSource).toContain("const pricingBreakdown = calculateInvoiceLinePricing({");
    expect(invoiceSource).toContain("chargedUnits: r.chargedUnits");
    expect(invoiceSource).toContain("dispatchedUnits: r.totalDispatchedUnits");
    expect(invoiceSource).toContain("fillAmountSnapshot: r.fillAmountSnapshot.toFixed(3)");
    expect(invoiceSource).toContain("fillUnitSnapshot: r.fillUnitSnapshot");
    expect(invoiceSource).toContain("perCartonPrice: r.pricingBreakdown.baseCartonRate.toString()");
    expect(invoiceSource).toContain("amount: r.pricingBreakdown.netAmount.toString()");
    expect(invoiceSource).toContain("margin: r.unitMargin.toString()");
    expect(invoiceSource).toContain("costOfGoodsSold: r.cogsTotal.toFixed(2)");
    expect(invoiceSource).toContain("costOfGoodsSoldPerUnit: r.cogsPerUnit.toFixed(4)");
    expect(invoiceSource).toContain("oldPrice: r.sourceBaseCartonRate.toString()");
    expect(invoiceSource).toContain("newPrice: r.pricingBreakdown.baseCartonRate.toString()");
    expect(invoiceSource).toContain("freeCartons: r.discountFreeCartons");
    expect(invoiceSource).toContain("grossAmount: r.pricingBreakdown.grossAmount");
    expect(invoiceSource).toContain("netAmount: r.pricingBreakdown.netAmount");
  });

  it("records invoice update timeline events and includes expense changes in diff summary", () => {
    const invoiceSource = readFileSync(
      resolve(SALES_FN_DIR, "invoices-fn.ts"),
      "utf8",
    );

    expect(invoiceSource).toContain('eventType: "updated"');
    expect(invoiceSource).toContain('title: `Invoice ${existing.invoiceNumber} updated`');
    expect(invoiceSource).toContain("Invoice Expense:");
    expect(invoiceSource).toContain("updateChangeMetadata.expenses");
    expect(invoiceSource).toContain("description: updateChanges.join");
  });

  it("keeps ledger date filters end-of-day safe and prevents non-chronological running-balance resorting", () => {
    const ledgerSource = readFileSync(
      resolve(SALES_FN_DIR, "ledger-fn.ts"),
      "utf8",
    );

    expect(ledgerSource).toContain("lte(dateField, endOfDay(toDate))");
    expect(ledgerSource).toContain("Ledger must stay chronological");
    expect(ledgerSource).toContain("const dateDifference = a.date.getTime() - b.date.getTime()");
    expect(ledgerSource).toContain("return a.id.localeCompare(b.id) * order");
    expect(ledgerSource).toContain("lineProfit - safeNumber(invoice.invoiceDiscount)");
  });

  it("threads approved returns through ledgers and audits full export fetches separately from paginated views", () => {
    const ledgerSource = readFileSync(
      resolve(SALES_FN_DIR, "ledger-fn.ts"),
      "utf8",
    );
    const printSource = readFileSync(
      resolve(SALES_COMPONENTS_DIR, "ledger-print-export.tsx"),
      "utf8",
    );

    expect(ledgerSource).toContain("buildApprovedReturnWindow");
    expect(ledgerSource).toContain("buildApprovedReturnBeforeDate");
    expect(ledgerSource).toContain('kind: "invoice" | "return" | "payment"');
    expect(ledgerSource).toContain('type: "return"');
    expect(ledgerSource).toContain('eq(payments.status, "confirmed")');
    expect(ledgerSource).toContain("payments.effectiveDate");
    expect(ledgerSource).toContain("runningBalance += totalPrice");
    expect(ledgerSource).toContain("runningBalance -= amount");
    expect(ledgerSource).toContain('includeFullEntries: z.boolean().optional()');
    expect(ledgerSource).toContain('exportType: z.enum(["view", "print", "csv", "pdf"]).optional()');
    expect(ledgerSource).toContain("entries: query.includeFullEntries");
    expect(ledgerSource).toContain('exportType: data.exportType ?? "view"');
    expect(ledgerSource).toContain("periodReturns:");
    expect(printSource).toContain("loadEntriesForExport");
    expect(printSource).toContain('if (entry.type === "payment")');
    expect(printSource).toContain("return entry.amount");
    expect(printSource).not.toContain('entry.method === "cash" || entry.method === "invoice_cash"');
  });

  it("protects invoice changes after returns and requires payment resolution before deletion", () => {
    const invoiceSource = readFileSync(
      resolve(SALES_FN_DIR, "invoices-fn.ts"),
      "utf8",
    );

    expect(invoiceSource).toContain("assertInvoiceMutationAllowed");
    expect(invoiceSource).toContain("INVOICE_HAS_CONFIRMED_PAYMENTS");
    expect(invoiceSource).toContain("INVOICE_HAS_PENDING_PAYMENTS");
    expect(invoiceSource).toContain("INVOICE_HAS_SALES_RETURNS");
    expect(invoiceSource).toContain("OFFLINE_INVOICE_IMMUTABLE");
    expect(invoiceSource).toContain('action: "delete"');
    expect(invoiceSource).toContain('action: "update"');
    expect(invoiceSource).toContain("recalculateInvoiceSettlement(tx, existing.id");
  });

  it("routes approved returns into sellable or segregated inventory based on condition", () => {
    const returnsSource = readFileSync(
      resolve(SALES_FN_DIR, "sales-returns-fn.ts"),
      "utf8",
    );

    expect(returnsSource).toContain("finishedGoodsStock");
    expect(returnsSource).toContain("returnedFinishedGoodsStock");
    expect(returnsSource).toContain('if (salesReturn.condition === "good")');
    expect(returnsSource).toContain("moved to ${salesReturn.condition} returned stock");
  });

  it("records a stock trace row for each approved return item", () => {
    const returnsSource = readFileSync(
      resolve(SALES_FN_DIR, "sales-returns-fn.ts"),
      "utf8",
    );

    expect(returnsSource).toContain("salesReturnStockTraces");
    expect(returnsSource).toContain("destination =");
    expect(returnsSource).toContain("await tx.insert(salesReturnStockTraces).values({");
    expect(returnsSource).toContain("totalUnitsMoved");
  });

  it("keeps invoice browser-facing server functions free of top-level db imports", () => {
    const invoiceSources = [
      "invoices-fn.ts",
      "invoice-detail-fn.ts",
      "invoice-timeline-fn.ts",
      "sales-returns-fn.ts",
    ].map((fileName) =>
      readFileSync(resolve(SALES_FN_DIR, fileName), "utf8"),
    );

    for (const source of invoiceSources) {
      expect(source).not.toContain('import { db } from "@/db"');
      expect(source).toContain('await import("@/db")');
    }
  });

  it("opens order conversion sheets once, keeps the initial warehouse clean, and blocks duplicate order invoicing", () => {
    const invoiceRouteSource = readFileSync(
      resolve(process.cwd(), "src/routes/_protected/sales/new-invoice/index.tsx"),
      "utf8",
    );
    const invoiceFormSource = readFileSync(
      resolve(SALES_COMPONENTS_DIR, "create-invoice-form.tsx"),
      "utf8",
    );
    const invoiceSource = readFileSync(
      resolve(SALES_FN_DIR, "invoice-posting-service.ts"),
      "utf8",
    );
    const invoiceHookSource = readFileSync(
      resolve(process.cwd(), "src/hooks/sales/use-invoices.ts"),
      "utf8",
    );
    const ordersRouteSource = readFileSync(
      resolve(process.cwd(), "src/routes/_protected/sales/orders/index.tsx"),
      "utf8",
    );

    expect(invoiceRouteSource).toContain("const autoOpenedOrderIdRef = useRef<string | null>(null);");
    expect(invoiceRouteSource).toContain("autoOpenedOrderIdRef.current !== orderId");
    expect(invoiceRouteSource).toContain("replace: true");
    expect(invoiceFormSource).toContain("const resolvedInitialWarehouseId = initialData?.warehouseId || warehouses[0]?.id || \"\";");
    expect(invoiceFormSource).toContain("warehouseId: resolvedInitialWarehouseId");
    expect(invoiceSource).toContain("Returned orders cannot be converted into invoices.");
    expect(invoiceSource).toContain("Order already converted to invoice");
    expect(invoiceHookSource).toContain("queryClient.invalidateQueries({ queryKey: [\"orders\"] });");
    expect(ordersRouteSource).toContain("const canConvertToInvoice =");
    expect(ordersRouteSource).toContain("order.status === \"pending\" || order.status === \"confirmed\"");
  });

  it("allocates booked-order bill numbers per order booker and ships a backfill migration", () => {
    const ordersFnSource = readFileSync(
      resolve(SALES_FN_DIR, "orders-fn.ts"),
      "utf8",
    );
    const salesSchemaSource = readFileSync(
      resolve(process.cwd(), "src/db/schemas/sales-erp-schema.ts"),
      "utf8",
    );
    const orderBillNumberSource = readFileSync(SALES_ORDER_BILL_FN, "utf8");
    const migrationPath = resolve(
      SALES_MIGRATIONS_DIR,
      "0006_order_booker_bill_numbers.sql",
    );

    expect(ordersFnSource).toContain("allocateNextBillNumberInTx");
    expect(ordersFnSource).toContain("billNumber,");
    expect(ordersFnSource).toContain("MAX_BILL_NUMBER_RETRIES");
    expect(ordersFnSource).toContain("isOrderBillNumberUniqueViolation");
    expect(orderBillNumberSource).toContain("const MAX_BILL_NUMBER_RETRIES = 5;");
    expect(orderBillNumberSource).toContain("ORDER_BILL_NUMBER_CONSTRAINT");
    expect(orderBillNumberSource).toContain("coalesce(max(${orders.billNumber}), 0) + 1");
    expect(salesSchemaSource).toContain("billNumber: integer(\"bill_number\").notNull()");
    expect(salesSchemaSource).toContain("uq_orders_order_booker_bill_number");
    expect(existsSync(migrationPath)).toBe(true);

    const migrationSource = readFileSync(migrationPath, "utf8");
    expect(migrationSource).toContain("DROP DEFAULT");
    expect(migrationSource).toContain("row_number() OVER");
    expect(migrationSource).toContain('PARTITION BY "order_booker_id"');
    expect(migrationSource).toContain("uq_orders_order_booker_bill_number");
  });

  it("resolves distributor and entity recipe rates server-side before trusting submitted carton rates", () => {
    const invoiceSource = ["invoices-fn.ts", "invoice-posting-service.ts"]
      .map((fileName) => readFileSync(resolve(SALES_FN_DIR, fileName), "utf8"))
      .join("\n");

    expect(invoiceSource).toContain("const buildConfiguredRecipePriceMap = async");
    expect(invoiceSource).toContain('eq(entityRecipeRates.entityType, "distributor")');
    expect(invoiceSource).toContain('eq(entityRecipeRates.entityType, "general")');
    expect(invoiceSource).toContain('eq(entityRecipeRates.entityType, "order_booker")');
    expect(invoiceSource).toContain("preferConfiguredRate:");
    expect(invoiceSource).toContain("!item.isPriceOverride && !item.preserveStoredDistributorRate");
    expect(invoiceSource).toContain("buildConfiguredRecipePriceMap({");
  });

  it("restricts distributor discount rules to active recipe-specific free-unit rules", () => {
    const discountSource = readFileSync(
      resolve(SALES_FN_DIR, "discount-rules-fn.ts"),
      "utf8",
    );

    expect(discountSource).toContain('ruleType: z.literal("free_units")');
    expect(discountSource).toContain("recipeId: z.string().min(1)");
    expect(discountSource).toContain('eq(discountRules.ruleType, "free_units")');
    expect(discountSource).toContain("getApplicableDistributorFreeCartons({");
    expect(discountSource).not.toContain('z.enum(["free_units", "discount_cartons", "percentage_off"])');
  });

  it("recomputes customer profile financial totals from invoices instead of trusting cached aggregates", () => {
    const source = readFileSync(SALES_CONFIG_FN, "utf8");

    expect(source).toContain("COALESCE(SUM(${invoices.amount}), 0)");
    expect(source).toContain("COALESCE(SUM(${invoices.paidAmount}), 0)");
    expect(source).toContain("COALESCE(SUM(${invoices.outstandingAmount}), 0)");
    expect(source).toContain("COALESCE(SUM(${invoices.invoiceDiscount}), 0)");
    expect(source).toContain("COALESCE(SUM(${invoiceItems.totalWeight}), 0)");
    expect(source).toContain("totalSale: String(Number(invoiceTotals?.totalSale) || 0)");
  });

  it("removes generic sales payment dialog so reconciliation stays the payment flow", () => {
    const routeSource = readFileSync(SALES_CUSTOMER_LEDGER_ROUTE, "utf8");
    const salesPaymentDialog = resolve(
      SALES_COMPONENTS_DIR,
      "record-payment-dialog.tsx",
    );

    expect(routeSource).not.toContain("RecordPaymentDialog");
    expect(routeSource).not.toContain("setPaymentDialogOpen");
    expect(routeSource).not.toContain("Record Payment");
    expect(existsSync(salesPaymentDialog)).toBe(false);
  });
});
