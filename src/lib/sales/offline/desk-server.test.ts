import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyOfflineSalesInvoice, isCustomerUsable, printedTotalDiffers } from "./classification.server";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("customer rule for offline invoices", () => {
  it("requires the signed distributor to still exist for a distributor sale", () => {
    expect(isCustomerUsable({ saleType: "direct_distributor", hasSignedCustomer: true, liveCustomer: { customerType: "distributor" } })).toBe(true);
    expect(isCustomerUsable({ saleType: "direct_distributor", hasSignedCustomer: true, liveCustomer: null })).toBe(false);
  });

  it("lets a retailer sale use a live non-distributor, or a brand-new walk-in", () => {
    expect(isCustomerUsable({ saleType: "direct_retailer", hasSignedCustomer: true, liveCustomer: { customerType: "retailer" } })).toBe(true);
    expect(isCustomerUsable({ saleType: "direct_retailer", hasSignedCustomer: true, liveCustomer: null })).toBe(false);
    // The customer was turned into a distributor after the workbook was issued.
    expect(isCustomerUsable({ saleType: "direct_retailer", hasSignedCustomer: true, liveCustomer: { customerType: "distributor" } })).toBe(false);
    expect(isCustomerUsable({ saleType: "direct_retailer", hasSignedCustomer: false, liveCustomer: null })).toBe(true);
  });
});

describe("desk invoices through staging and posting", () => {
  const upload = read("src/server-functions/sales/offline-upload-fn.ts");
  const posting = read("src/lib/sales/offline/posting.server.ts");

  it("stages a cancelled invoice as excluded so it keeps its number but never posts", () => {
    expect(upload).toContain('status: cancelled ? "excluded" : classification.status');
    expect(upload).toContain("Cancelled at the desk:");
    expect(upload).toContain("excludedInvoices: counts.excluded");
  });

  it("stores the walk-in customer, discount, freight and payment details", () => {
    expect(upload).toContain("customerDetails: invoice.customerDetails");
    expect(upload).toContain("invoiceDiscount: (invoice.invoiceDiscount ?? 0).toFixed(2)");
    expect(upload).toContain("expenses: (invoice.expenses ?? 0).toFixed(2)");
    expect(upload).toContain("instantVerify: Boolean(payment.instantVerify)");
    expect(upload).toContain("notes: payment.notes ?? null");
  });

  it("posts retailer sales through the shared invoice service with the same money fields", () => {
    expect(posting).toContain("resolveRetailCustomer");
    expect(posting).toContain("expenses: Number(staged.expenses)");
    expect(posting).toContain("invoiceDiscount: Number(staged.invoiceDiscount)");
    expect(posting).toContain("instantVerify: payment.instantVerify");
    expect(posting).toContain("notes: payment.notes ?? undefined");
    expect(posting).toContain("offlineSaleType: staged.saleType");
  });

  it("matches a new walk-in to an existing customer by mobile before creating one", () => {
    expect(posting).toContain("lower(${customers.mobileNumber}) = lower(${details.mobile.trim()})");
    expect(posting).toContain('customerType: "retailer"');
  });

  it("posts a salary paid by the distributor without an account and without a source record", () => {
    expect(posting).toContain('method: "expense_offset" as const');
    expect(posting).toContain("expenseEmployeeId: payment.expenseEmployeeId ?? undefined");
    expect(posting).toContain('if (payment.method === "expense_offset") continue;');
  });

  it("stores the manual free cartons and the price change with the listed price", () => {
    expect(upload).toContain("manualFreeCartons: item.manualFreeCartons ?? 0");
    expect(upload).toContain("isPriceOverride: Boolean(item.isPriceOverride)");
    expect(upload).toContain("hasPriceOverride: invoice.items.some");
  });
});

describe("price changes at the desk", () => {
  const base = {
    parseIssueCodes: [],
    identityState: "new" as const,
    workbookStatus: "active" as const,
    distributorUsable: true,
    productsUsable: true,
    walletsUsable: true,
    orderState: "not_applicable" as const,
    hasStockShortage: false,
    creditHoldActive: false,
    creditLimitExceeded: false,
    staleSnapshot: false,
  };

  it("holds a changed price as a warning for the office to acknowledge", () => {
    expect(classifyOfflineSalesInvoice({ ...base, hasPriceOverride: true })).toEqual({
      status: "warning",
      issueCodes: ["price_override"],
    });
  });

  it("leaves an unchanged price ready", () => {
    expect(classifyOfflineSalesInvoice({ ...base, hasPriceOverride: false }).status).toBe("ready");
  });
});

describe("printed total safety net", () => {
  it("notices a printed total that differs from the system's by more than half a paisa", () => {
    expect(printedTotalDiffers(10500, "10500.00")).toBe(false);
    expect(printedTotalDiffers("10500.004", 10500)).toBe(false);
    expect(printedTotalDiffers(10500, "10600.00")).toBe(true);
    expect(printedTotalDiffers(null, "10500.00")).toBe(false);
    expect(printedTotalDiffers(undefined, "10500.00")).toBe(false);
  });

  it("warns the office instead of rejecting a printed invoice", () => {
    const result = classifyOfflineSalesInvoice({
      parseIssueCodes: [],
      identityState: "new",
      workbookStatus: "active",
      distributorUsable: true,
      productsUsable: true,
      walletsUsable: true,
      orderState: "not_applicable",
      hasStockShortage: false,
      creditHoldActive: false,
      creditLimitExceeded: false,
      staleSnapshot: false,
      extraWarningCodes: ["printed_total_changed"],
    });
    expect(result).toEqual({ status: "warning", issueCodes: ["printed_total_changed"] });
  });

  it("is checked at staging and again when the office refreshes a batch", () => {
    expect(read("src/server-functions/sales/offline-upload-fn.ts")).toContain("printedTotalDiffers(invoice.printedTotal, invoice.invoiceAmount)");
    expect(read("src/server-functions/sales/offline-review-fn.ts")).toContain("printedTotalDiffers(invoice.printedTotal, invoice.invoiceAmount)");
  });
});
