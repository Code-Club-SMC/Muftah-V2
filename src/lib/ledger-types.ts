/**
 * Customer ledger rules:
 * - An invoice adds its full total to the amount owed.
 * - A confirmed payment reduces the amount owed.
 * - A received return reduces the amount owed at completion; its void adds it back at void time.
 * - Pending, returned, cancelled, and reversed payments are not ledger money.
 */

export interface LedgerInvoiceItem {
  id: string;
  pack: string;
  numberOfCartons: number;
  discountCartons: number;
  freeCartons: number | null;
  quantity: number;
  packsPerCarton: number;
  actualPackSize: number | null;
  perCartonPrice: string;
  amount: string;
  costOfGoodsSold: string;
  hsnCode: string;
  retailPrice: string;
}

export interface LedgerInvoiceEntry {
  type: "invoice";
  id: string;
  date: Date;
  invoiceNumber: string;
  warehouseName: string | null;
  totalPrice: number;
  paidAmount: number;
  returnedAmount: number;
  outstandingAmount: number;
  paymentDueDate: Date | null;
  paymentStatus: string;
  status: string;
  runningBalance: number;
  items: LedgerInvoiceItem[];
  expenses: number;
  expensesDescription: string | null;
  remarks: string | null;
  recoveryStatus: string | null;
  recoveryOutstandingAmount: number;
  customerName?: string | null;
}

export interface LedgerPaymentEntry {
  type: "payment";
  id: string;
  date: Date;
  reference: string | null;
  method: string;
  isStoreCreditApplied?: boolean;
  amount: number;
  notes: string | null;
  runningBalance: number;
  invoiceId: string;
  invoiceNumber: string;
  customerName?: string | null;
  walletName?: string | null;
  walletType?: string | null;
  chequeNumber?: string | null;
  chequeBank?: string | null;
  chequeDate?: Date | null;
}

export interface LedgerReturnEntry {
  type: "return";
  eventKind: "return" | "void";
  id: string;
  date: Date;
  returnNumber: number;
  creditNoteNumber?: string | null;
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  reason: string;
  condition: string;
  status: string;
  notes: string | null;
  runningBalance: number;
  customerName?: string | null;
}

export interface LedgerRefundEntry {
  type: "refund";
  eventKind: "refund" | "refund_reversal";
  id: string;
  date: Date;
  amount: number;
  creditNoteNumber?: string | null;
  walletName?: string | null;
  notes?: string | null;
  reverseReason?: string | null;
  runningBalance: number;
  customerName?: string | null;
}

export type LedgerEntry =
  | LedgerInvoiceEntry
  | LedgerPaymentEntry
  | LedgerReturnEntry
  | LedgerRefundEntry;

export type LedgerExportType = "view" | "print" | "csv" | "pdf";
export type LedgerTypeFilter =
  | "all"
  | "invoice"
  | "payment"
  | "return"
  | "refund";

export interface LedgerSummary {
  openingBalance: number;
  closingBalance: number;
  periodTotalSales: number;
  periodPayments: number;
  periodReturns: number; // Net receipt credit minus void reversals in the period.
  periodTotalProfit: number;
  invoiceCount: number;
  paymentCount: number;
}

export interface LedgerCustomerInfo {
  id: string;
  name: string;
  city?: string | null;
  mobileNumber?: string | null;
  outstandingAmount?: string | number | null;
  creditBalance?: string | number | null;
  customerType?: string | null;
}

export function computeChronologicalLedgerStep(
  currentBalance: number,
  event:
    | { type: "invoice"; totalPrice: number }
    | { type: "payment"; method: string; amount: number }
    | { type: "return"; eventKind: "return" | "void"; amount: number }
    | { type: "refund"; eventKind: "refund" | "refund_reversal"; amount: number },
): number {
  const round = (v: number) => Math.round(v * 100) / 100;
  if (event.type === "invoice") return round(currentBalance + event.totalPrice);
  if (event.type === "return") {
    return event.eventKind === "return"
      ? round(currentBalance - event.amount)
      : round(currentBalance + event.amount);
  }
  if (event.type === "refund") {
    return event.eventKind === "refund"
      ? round(currentBalance + event.amount)
      : round(currentBalance - event.amount);
  }
  if (event.method === "customer_credit") return round(currentBalance);
  return round(currentBalance - event.amount);
}

export interface DistributorLedgerResponse {
  customer: LedgerCustomerInfo;
  entries: LedgerEntry[];
  summary: LedgerSummary;
  generatedAt: string;
  generatedBy: string;
  page: number;
  pageCount: number;
  totalEntries: number;
}

export interface SalesmanLedgerResponse {
  salesman: { id: string; name: string };
  entries: LedgerEntry[];
  summary: LedgerSummary;
  generatedAt: string;
  generatedBy: string;
  page: number;
  pageCount: number;
  totalEntries: number;
}

export interface LedgerQueryParams {
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
  search?: string;
  sortBy?: "date";
  sortOrder?: "asc" | "desc";
  typeFilter?: LedgerTypeFilter;
  includeFullEntries?: boolean;
  exportType?: LedgerExportType;
}

export interface DistributorLedgerParams extends LedgerQueryParams {
  customerId: string;
}

export interface SalesmanLedgerParams extends LedgerQueryParams {
  salesmanId: string;
}

export interface ShopkeeperLedgerParams extends LedgerQueryParams {
  customerId: string;
}

export type ShopkeeperLedgerResponse = DistributorLedgerResponse;

export interface LedgerExportColumn {
  key: string;
  label: string;
  format?: (value: unknown, entry: LedgerEntry) => string;
  includeInCsv?: boolean;
  includeInPrint?: boolean;
}

export interface LedgerExportConfig {
  title: string;
  subtitle?: string;
  periodLabel?: string;
  columns: LedgerExportColumn[];
  includeLineItems?: boolean;
  includeSummary?: boolean;
  watermark?: { text: string; opacity?: number };
}

export interface LedgerExportAudit {
  id?: string;
  userId: string;
  userName: string;
  customerId: string;
  customerName: string;
  exportType: "csv" | "pdf" | "print" | "email";
  periodFrom?: string;
  periodTo?: string;
  entryCount: number;
  generatedAt: Date;
  ipAddress?: string;
}
