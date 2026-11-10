import { getApplicableDistributorFreeCartons } from "@/lib/sales/distributor-discount-rules";
import { OFFLINE_SALES_MAX_ITEMS_PER_INVOICE } from "./constants";
import type {
  OfflineSalesReferenceSnapshot,
  OfflineSalesSaleType,
  ParsedOfflineSalesInvoice,
} from "./contracts";

/**
 * Pure invoice maths for browser-entered offline invoices.
 *
 * The browser uses it for live totals and the printed copy. The server runs the
 * exact same function against its own signed snapshot, so the stored amounts
 * never depend on what the browser claims. Keep this file free of Node imports.
 *
 * It follows the online invoice rules: a distributor pays the distributor rate
 * and gets the saved free-carton scheme; a retailer or walk-in pays the general
 * rate; any invoice can get an invoice discount; freight and other
 * expenses add to the total; bank and digital payments carry the same details
 * the online form asks for.
 */

export type OfflineEntryItem = {
  productCode: string;
  cartonQuantity: number;
  looseUnitQuantity: number;
  physicalStockConfirmed: boolean;
  /** Cartons given free by hand, on top of any scheme. Not for booked orders. */
  manualFreeCartons?: number;
  /** Carton price typed over the price list. Not for booked orders. */
  priceOverride?: number | null;
};

export type OfflineNewCustomerInput = {
  name: string;
  mobile: string | null;
  city: string | null;
  address: string | null;
};

export type OfflineEntryPayment = {
  method: "cash" | "bank_transfer" | "cheque" | "expense_offset";
  /** "Salesman salary paid by distributor": the salesman's employee id. No account is used. */
  expenseEmployeeId?: string | null;
  amount: number;
  walletCode: string;
  reference: string | null;
  chequeBank: string | null;
  chequeNumber: string | null;
  chequeDate: string | null;
  paymentDate: string;
  /** Funds already confirmed in the company account. Bank, digital and cheque only. */
  instantVerify?: boolean;
  /** A "Digital Account" payment is a bank transfer with these details, as online. */
  digital?: { provider: string; senderMobile: string; senderTitle: string | null } | null;
  /** Sender's bank details for a plain bank transfer, as online. */
  bank?: { senderBankName: string; senderAccountNumber: string } | null;
  notes?: string | null;
};

export type OfflineEntry = {
  slotNumber: number;
  recordToken: string;
  saleDate: string;
  saleTime: string;
  saleType: OfflineSalesSaleType;
  /** Code of an existing customer: a distributor (D-n) or a retailer (C-n). */
  distributorCode: string | null;
  /** A walk-in customer who does not exist yet. */
  newCustomer?: OfflineNewCustomerInput | null;
  orderBookerCode: string | null;
  billNumber: number | null;
  paymentDueDate: string | null;
  remarks: string | null;
  invoiceDiscount?: number;
  invoiceDiscountDescription?: string | null;
  expenses?: number;
  expensesDescription?: string | null;
  items: OfflineEntryItem[];
  payments: OfflineEntryPayment[];
  /** Printed invoice that was cancelled at the desk. It keeps its number. */
  cancelled?: { reason: string; at: string } | null;
  /** The invoice total the desk showed and printed. The server compares it with its own. */
  printedTotal?: number;
};

/** The part of the signed snapshot the calculator needs. The full snapshot fits. */
export type OfflineCalcReference = {
  generatedAt: string;
  distributors: Array<{ id: string; code: string }>;
  retailers: Array<{ id: string; code: string; customerType: string }>;
  products: Array<{
    recipeId: string;
    code: string;
    packsPerCarton: number;
    distributorCartonPrice: string;
    generalCartonPrice: string;
    distributorPrices: Array<{ customerId: string; cartonPrice: string }>;
    wacPerPack?: string;
    stockUnits?: number;
  }>;
  discountRules: OfflineSalesReferenceSnapshot["discountRules"];
  orders: Array<{
    orderBookerCode: string;
    billNumber: number;
    items: Array<{
      productCode: string;
      unitType: string;
      quantity: number;
      cartonRate: string;
    }>;
  }>;
  wallets: Array<{ code: string; type: "cash" | "bank" }>;
  salesmen: Array<{ employeeId: string; name: string }>;
};

export type OfflineEntryIssue = ParsedOfflineSalesInvoice["parseIssues"][number];

export type CalculatedOfflineItem = {
  productCode: string;
  cartonQuantity: number;
  looseUnitQuantity: number;
  packsPerCarton: number;
  /** Price actually charged per carton (the override if one was typed). */
  baseCartonPrice: number;
  /** Price in the signed list, before any override. */
  listedCartonPrice: number;
  isPriceOverride: boolean;
  /** Free cartons from the saved scheme (distributors only). */
  freeCartons: number;
  /** Free cartons given by hand. */
  manualFreeCartons: number;
  chargedUnits: number;
  dispatchedUnits: number;
  lineAmount: number;
  wacPerPack: number;
  stockUnitsSnapshot: number;
  physicalStockConfirmed: boolean;
};

export type CalculatedOfflinePayment = Omit<
  OfflineEntryPayment,
  "digital" | "bank" | "notes" | "instantVerify" | "expenseEmployeeId"
> & {
  notes: string | null;
  instantVerify: boolean;
  expenseType: string | null;
  expenseEmployeeId: string | null;
};

export type CalculatedOfflineInvoice = {
  invoiceNumber: string;
  items: CalculatedOfflineItem[];
  payments: CalculatedOfflinePayment[];
  /** Sum of the lines, before discount and expenses. */
  itemsTotal: number;
  invoiceDiscount: number;
  expenses: number;
  /** What the customer owes in total: lines - discount + expenses. */
  invoiceAmount: number;
  paidAmount: number;
  pendingAmount: number;
  outstandingAmount: number;
  /** The part with no payment against it at all. Needs a due date. */
  payLaterAmount: number;
  issues: OfflineEntryIssue[];
};

export function money(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function issue(code: string, message: string, source: string, value?: string): OfflineEntryIssue {
  return { code, message, source, ...(value !== undefined ? { value } : {}) };
}

export function isValidDateLiteral(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return (
    date.getUTCFullYear() === Number(match[1]) &&
    date.getUTCMonth() + 1 === Number(match[2]) &&
    date.getUTCDate() === Number(match[3])
  );
}

export function isValidTimeLiteral(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return Boolean(match && Number(match[1]) < 24 && Number(match[2]) < 60);
}

/** `OFF-F01-20261103-007`. The serial is reserved by the server and never reused. */
export function formatOfflineInvoiceNumber(saleDate: string, serial: number) {
  const padded = String(serial).padStart(3, "0");
  return isValidDateLiteral(saleDate)
    ? `OFF-F01-${saleDate.replaceAll("-", "")}-${padded}`
    : `OFF-F01-INVALID-${padded}`;
}

function unitsOfOrderItem(
  item: { unitType: string; quantity: number },
  packsPerCarton: number,
) {
  if (item.unitType === "full_carton") return item.quantity * packsPerCarton;
  if (item.unitType === "half_carton") return (item.quantity * packsPerCarton) / 2;
  return item.quantity;
}

/** Items a booked order expects, as whole cartons plus loose packs, per product. */
export function bookedOrderItems(
  order: OfflineCalcReference["orders"][number],
  products: OfflineCalcReference["products"],
): OfflineEntryItem[] {
  const units = new Map<string, number>();
  for (const item of order.items) {
    const product = products.find((value) => value.code === item.productCode);
    if (!product) continue;
    units.set(
      item.productCode,
      (units.get(item.productCode) ?? 0) + unitsOfOrderItem(item, product.packsPerCarton),
    );
  }
  return [...units].flatMap(([productCode, total]) => {
    const product = products.find((value) => value.code === productCode);
    if (!product) return [];
    return [
      {
        productCode,
        cartonQuantity: Math.floor(total / product.packsPerCarton),
        looseUnitQuantity: total % product.packsPerCarton,
        physicalStockConfirmed: false,
      },
    ];
  });
}

/**
 * Text saved with a bank or digital payment. It is word for word what the
 * online invoice form saves, so finance sees the same note either way.
 */
export function paymentNotes(payment: OfflineEntryPayment) {
  const typed = payment.notes?.trim() || undefined;
  if (payment.method !== "bank_transfer") return typed ?? null;
  if (payment.digital) {
    const provider = payment.digital.provider.trim() || "Digital Account";
    const title = payment.digital.senderTitle?.trim();
    const prefix = `[${provider}] From: ${payment.digital.senderMobile.trim()}${title ? ` (${title})` : ""}`;
    return typed ? `${prefix} · ${typed}` : prefix;
  }
  const bankName = payment.bank?.senderBankName.trim();
  const account = payment.bank?.senderAccountNumber.trim();
  if (bankName || account) {
    const prefix = `From: ${bankName || "Unknown Bank"} (A/C: ${account || "—"})`;
    return typed ? `${prefix} · ${typed}` : prefix;
  }
  return typed ?? null;
}

/** Who the invoice is for, resolved against the signed reference. */
export function resolveEntryCustomer(entry: OfflineEntry, reference: OfflineCalcReference) {
  const distributor = entry.distributorCode
    ? reference.distributors.find((value) => value.code === entry.distributorCode)
    : undefined;
  const retailer = entry.distributorCode
    ? reference.retailers.find((value) => value.code === entry.distributorCode)
    : undefined;
  return { distributor, retailer };
}

export function calculateOfflineEntry(
  entry: OfflineEntry,
  reference: OfflineCalcReference,
  serial: number,
): CalculatedOfflineInvoice {
  const issues: OfflineEntryIssue[] = [];
  const retail = entry.saleType === "direct_retailer";
  const booked = entry.saleType === "booked_order";

  const dateOk = isValidDateLiteral(entry.saleDate);
  if (!dateOk) issues.push(issue("invalid_sale_date", "Enter a valid Sale Date", "Invoice", entry.saleDate));
  if (!isValidTimeLiteral(entry.saleTime)) issues.push(issue("invalid_sale_time", "Enter Sale Time as HH:mm", "Invoice", entry.saleTime));
  if (!["direct_distributor", "direct_retailer", "booked_order"].includes(entry.saleType)) {
    issues.push(issue("invalid_sale_type", "Choose a valid Sale Type", "Invoice", entry.saleType));
  }

  const { distributor, retailer } = resolveEntryCustomer(entry, reference);
  const newCustomerName = entry.newCustomer?.name.trim() ?? "";
  if (entry.saleType === "direct_distributor") {
    if (!entry.distributorCode) issues.push(issue("missing_distributor", "Choose a distributor", "Invoice"));
    else if (!distributor) issues.push(issue("unknown_distributor", "Distributor is not in the signed reference", "Invoice", entry.distributorCode));
    if (entry.newCustomer) issues.push(issue("unexpected_customer", "A distributor sale cannot create a new customer", "Invoice"));
  }
  if (retail) {
    if (entry.distributorCode && entry.newCustomer) {
      issues.push(issue("customer_conflict", "Choose an existing customer or enter a new one, not both", "Invoice"));
    } else if (entry.distributorCode) {
      if (!retailer) issues.push(issue("unknown_customer", "Customer is not in the signed reference", "Invoice", entry.distributorCode));
    } else if (newCustomerName.length < 2) {
      issues.push(issue("missing_customer", "Choose a customer or enter the new customer's name", "Invoice"));
    }
  }
  if ((entry.saleType === "direct_distributor" || retail) && (entry.orderBookerCode || entry.billNumber !== null)) {
    issues.push(issue("unexpected_order", "Clear Order Booker and Bill Number for a direct sale", "Invoice"));
  }
  if (booked && (!entry.orderBookerCode || entry.billNumber === null || entry.billNumber < 1)) {
    issues.push(issue("missing_order", "Choose a booked order", "Invoice"));
  }
  if (booked && (entry.distributorCode || entry.newCustomer)) {
    issues.push(issue("unexpected_distributor", "Clear the customer for a booked order", "Invoice", entry.distributorCode ?? ""));
  }
  if (entry.paymentDueDate && !isValidDateLiteral(entry.paymentDueDate)) {
    issues.push(issue("invalid_due_date", "Enter a valid Payment Due Date", "Invoice", entry.paymentDueDate));
  }
  if ((entry.remarks ?? "").length > 500) {
    issues.push(issue("remarks_too_long", "Shorten Remarks to 500 characters or fewer", "Invoice"));
  }

  const products = new Map(reference.products.map((product) => [product.code, product]));
  const order = reference.orders.find(
    (value) =>
      value.orderBookerCode === entry.orderBookerCode && value.billNumber === entry.billNumber,
  );

  const items: CalculatedOfflineItem[] = [];
  entry.items.forEach((raw, index) => {
    const source = `Item ${index + 1}`;
    const product = products.get(raw.productCode);
    const cartons = raw.cartonQuantity;
    const loose = raw.looseUnitQuantity;
    if (!product) issues.push(issue("unknown_product", "Choose a product from the list", source, raw.productCode));
    if (!Number.isSafeInteger(cartons) || cartons < 0) issues.push(issue("invalid_cartons", "Enter Carton Quantity as a whole number", source, String(cartons)));
    if (!Number.isSafeInteger(loose) || loose < 0) issues.push(issue("invalid_loose_units", "Enter Loose Unit Quantity as a whole number", source, String(loose)));
    if ((cartons || 0) + (loose || 0) < 1) issues.push(issue("empty_item", "Enter at least one carton or loose unit", source));
    if (!product || !Number.isSafeInteger(cartons) || cartons < 0 || !Number.isSafeInteger(loose) || loose < 0) return;

    let baseCartonPrice = Number(product.distributorCartonPrice);
    let freeCartons = 0;
    if (entry.saleType === "direct_distributor") {
      const customerRate = product.distributorPrices.find((rate) => rate.customerId === distributor?.id);
      baseCartonPrice = Number(customerRate?.cartonPrice ?? product.distributorCartonPrice);
      if (distributor) {
        freeCartons = getApplicableDistributorFreeCartons({
          rules: reference.discountRules
            .filter((rule) => rule.customerId === distributor.id)
            .map((rule) => ({ ...rule, ruleType: "free_units", freeUnits: rule.freeCartons, isActive: true })),
          recipeId: product.recipeId,
          numberOfCartons: cartons,
          now: new Date(reference.generatedAt),
        }).freeCartons;
      }
    } else if (retail) {
      // Retailers and walk-ins pay the general rate and get no free-carton scheme.
      baseCartonPrice = Number(product.generalCartonPrice);
    } else {
      const orderItem = order?.items.find((item) => item.productCode === product.code);
      if (!order) issues.push(issue("unknown_order", "Booked order is not in the signed reference", "Invoice"));
      if (!orderItem) issues.push(issue("product_not_in_order", "Product is not part of the booked order", source));
      baseCartonPrice = Number(orderItem?.cartonRate ?? 0);
    }
    if (!Number.isFinite(baseCartonPrice) || baseCartonPrice < 0) {
      issues.push(issue("invalid_signed_price", "Signed product price is invalid", source));
      baseCartonPrice = 0;
    }
    const listedCartonPrice = baseCartonPrice;

    // Price typed over the list, as online. A booked order keeps its saved rate.
    let isPriceOverride = false;
    if (raw.priceOverride !== undefined && raw.priceOverride !== null) {
      if (booked) {
        issues.push(issue("override_not_allowed", "A booked order keeps its saved rate", source));
      } else if (!Number.isFinite(raw.priceOverride) || raw.priceOverride < 0) {
        issues.push(issue("invalid_price_override", "Enter a carton price of zero or more", source, String(raw.priceOverride)));
      } else if (money(raw.priceOverride) !== money(listedCartonPrice)) {
        isPriceOverride = true;
        baseCartonPrice = money(raw.priceOverride);
      }
    }

    // Free cartons given by hand, as online: cannot exceed the cartons entered.
    const manual = raw.manualFreeCartons ?? 0;
    if (!Number.isSafeInteger(manual) || manual < 0) {
      issues.push(issue("invalid_manual_free", "Enter free cartons as a whole number", source, String(manual)));
    } else if (manual > 0 && booked) {
      issues.push(issue("manual_free_not_allowed", "A booked order has no free cartons", source));
    } else if (manual > cartons) {
      issues.push(issue("manual_free_exceeds", "Manual free cartons cannot exceed the cartons entered", source));
    }
    const manualFreeCartons = Number.isSafeInteger(manual) && manual > 0 && !booked ? Math.min(manual, cartons) : 0;

    // A distributor is shipped the free cartons on top of what was ordered and
    // billed for the ordered ones. Everyone else is billed for the ordered
    // cartons less the free ones. The server's pricing does the same.
    const additive = entry.saleType === "direct_distributor";
    const chargedCartons = additive ? cartons : cartons - manualFreeCartons;
    const dispatchedCartons = additive ? cartons + freeCartons + manualFreeCartons : cartons;
    items.push({
      productCode: product.code,
      cartonQuantity: cartons,
      looseUnitQuantity: loose,
      packsPerCarton: product.packsPerCarton,
      baseCartonPrice,
      listedCartonPrice,
      isPriceOverride,
      freeCartons,
      manualFreeCartons,
      chargedUnits: chargedCartons * product.packsPerCarton + loose,
      dispatchedUnits: dispatchedCartons * product.packsPerCarton + loose,
      lineAmount: money(chargedCartons * baseCartonPrice + loose * (baseCartonPrice / product.packsPerCarton)),
      wacPerPack: Number(product.wacPerPack ?? 0),
      stockUnitsSnapshot: product.stockUnits ?? 0,
      physicalStockConfirmed: raw.physicalStockConfirmed,
    });
  });

  if (entry.items.length === 0) issues.push(issue("missing_items", "Invoice needs at least one item", "Invoice"));
  if (entry.items.length > OFFLINE_SALES_MAX_ITEMS_PER_INVOICE) {
    issues.push(issue("too_many_items", `Invoice cannot contain more than ${OFFLINE_SALES_MAX_ITEMS_PER_INVOICE} items`, "Invoice"));
  }
  const duplicate = entry.items.findIndex(
    (item, index, all) => all.findIndex((other) => other.productCode === item.productCode) !== index,
  );
  if (duplicate >= 0) issues.push(issue("duplicate_product", "Combine duplicate product rows into one item", `Item ${duplicate + 1}`));

  if (booked && order) {
    const actual = new Map<string, number>();
    items.forEach((item) => actual.set(item.productCode, (actual.get(item.productCode) ?? 0) + item.chargedUnits));
    const expected = new Map<string, number>();
    for (const item of order.items) {
      const product = products.get(item.productCode);
      expected.set(
        item.productCode,
        (expected.get(item.productCode) ?? 0) + unitsOfOrderItem(item, product?.packsPerCarton ?? 0),
      );
    }
    if ([...new Set([...actual.keys(), ...expected.keys()])].some((code) => actual.get(code) !== expected.get(code))) {
      issues.push(issue("booked_order_quantity_mismatch", "Items must exactly match the booked order quantities", "Invoice"));
    }
  }

  const itemsTotal = money(items.reduce((total, item) => total + item.lineAmount, 0));

  // Invoice discount: any invoice type, never more than the items total.
  const invoiceDiscount = money(entry.invoiceDiscount ?? 0);
  if (!Number.isFinite(invoiceDiscount) || invoiceDiscount < 0) {
    issues.push(issue("invalid_discount", "Discount cannot be negative", "Invoice"));
  } else if (invoiceDiscount > itemsTotal) {
    issues.push(issue("discount_exceeds_total", `Discount (${invoiceDiscount.toFixed(2)}) cannot exceed items total (${itemsTotal.toFixed(2)})`, "Invoice"));
  }
  const expenses = money(entry.expenses ?? 0);
  if (!Number.isFinite(expenses) || expenses < 0) issues.push(issue("invalid_expenses", "Freight and expenses cannot be negative", "Invoice"));
  const netAmount = money(Math.max(0, itemsTotal - invoiceDiscount));
  const invoiceAmount = money(netAmount + expenses);

  const wallets = new Map(reference.wallets.map((wallet) => [wallet.code, wallet]));
  const payments: CalculatedOfflinePayment[] = [];
  entry.payments.forEach((raw, index) => {
    const source = `Payment ${index + 1}`;
    const validMethod = ["cash", "bank_transfer", "cheque", "expense_offset"].includes(raw.method);
    const validAmount = Number.isFinite(raw.amount) && raw.amount > 0;
    const validDate = isValidDateLiteral(raw.paymentDate);
    if (!validMethod) issues.push(issue("invalid_payment_method", "Choose cash, bank transfer, cheque, or salary paid by distributor", source, raw.method));
    if (!validAmount) issues.push(issue("invalid_payment_amount", "Enter Payment Amount greater than zero", source, String(raw.amount)));
    if (!validDate) issues.push(issue("invalid_payment_date", "Enter a valid Payment Date", source, raw.paymentDate));

    if (raw.method === "expense_offset") {
      // The distributor paid a salesman's salary instead of paying us. No account is involved.
      const salesman = reference.salesmen.find((value) => value.employeeId === raw.expenseEmployeeId);
      if (!salesman) issues.push(issue("invalid_salesman", "Choose the salesman whose salary was paid", source));
      if (!validAmount || !validDate || !salesman) return;
      const typed = raw.notes?.trim();
      const base = `Salary paid directly by distributor for ${salesman.name}`;
      payments.push({
        method: "expense_offset",
        amount: money(raw.amount),
        walletCode: "expense_offset",
        reference: null,
        chequeBank: null,
        chequeNumber: null,
        chequeDate: null,
        paymentDate: raw.paymentDate,
        notes: typed ? `${base} · ${typed}` : base,
        instantVerify: false,
        expenseType: "salesman_salary",
        expenseEmployeeId: salesman.employeeId,
      });
      return;
    }

    const wallet = wallets.get(raw.walletCode);
    const chequeDateOk = Boolean(raw.chequeDate && isValidDateLiteral(raw.chequeDate));
    if (!wallet || (raw.method === "cash" ? wallet.type !== "cash" : wallet.type !== "bank")) {
      issues.push(issue("invalid_payment_wallet", "Choose a matching cash or bank account", source, raw.walletCode));
    }
    if (raw.method === "bank_transfer") {
      if (!raw.reference?.trim()) issues.push(issue("missing_transfer_reference", raw.digital ? "Enter the Transaction ID (TID)" : "Enter Transfer Reference", source));
      if (raw.digital) {
        if (!raw.digital.provider.trim()) issues.push(issue("missing_digital_provider", "Choose the digital platform", source));
        if (!raw.digital.senderMobile.trim()) issues.push(issue("missing_digital_sender", "Enter the sender's mobile or account number", source));
      } else {
        if (!raw.bank?.senderBankName.trim()) issues.push(issue("missing_sender_bank", "Enter the customer's bank name", source));
        if (!raw.bank?.senderAccountNumber.trim()) issues.push(issue("missing_sender_account", "Enter the customer's account number or IBAN", source));
      }
    }
    if (raw.method === "cheque" && (!raw.chequeBank || !raw.chequeNumber || !chequeDateOk)) {
      issues.push(issue("missing_cheque_details", "Enter Cheque Bank, Number, and Date", source));
    }
    if (!validMethod || !validAmount || !wallet || !validDate) return;
    payments.push({
      method: raw.method,
      amount: money(raw.amount),
      walletCode: wallet.code,
      reference: raw.reference?.trim() || null,
      chequeBank: raw.chequeBank,
      chequeNumber: raw.chequeNumber,
      chequeDate: raw.chequeDate,
      paymentDate: raw.paymentDate,
      notes: paymentNotes(raw),
      instantVerify: raw.method !== "cash" && Boolean(raw.instantVerify),
      expenseType: null,
      expenseEmployeeId: null,
    });
  });

  // Same split the server uses: cash, salary offsets and instantly-verified funds are paid,
  // other bank money waits for finance, the rest is still to be paid later.
  const settled = (value: CalculatedOfflinePayment) =>
    value.method === "cash" || value.method === "expense_offset" || value.instantVerify;
  const paidAmount = money(payments.filter(settled).reduce((total, value) => total + value.amount, 0));
  const pendingAmount = money(payments.filter((value) => !settled(value)).reduce((total, value) => total + value.amount, 0));
  const outstandingAmount = money(Math.max(0, invoiceAmount - paidAmount));
  const payLaterAmount = money(invoiceAmount - paidAmount - pendingAmount);
  if (money(paidAmount + pendingAmount) > invoiceAmount) issues.push(issue("payments_exceed_invoice", "Payments cannot exceed Invoice Total", "Invoice"));
  if (payLaterAmount > 0 && !entry.paymentDueDate) {
    issues.push(issue("missing_due_date", "Payment Due Date is required when an amount remains payable later", "Invoice"));
  }

  return {
    invoiceNumber: formatOfflineInvoiceNumber(entry.saleDate, serial),
    items,
    payments,
    itemsTotal,
    invoiceDiscount: Number.isFinite(invoiceDiscount) ? invoiceDiscount : 0,
    expenses: Number.isFinite(expenses) ? expenses : 0,
    invoiceAmount,
    paidAmount,
    pendingAmount,
    outstandingAmount,
    payLaterAmount: Math.max(0, payLaterAmount),
    issues,
  };
}
