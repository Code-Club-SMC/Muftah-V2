import type {
  OfflineNewCustomer,
  OfflineSalesBatchStatus,
  OfflineSalesInvoiceStatus,
  OfflineSalesWorkbookStatus,
} from "@/db/schemas/offline-sales-schema";

export const OFFLINE_SALES_WORKBOOK_FORMAT = "titan-offline-sales" as const;

export type OfflineSalesSaleType =
  | "direct_distributor"
  | "direct_retailer"
  | "booked_order";

export type OfflineSalesManifest = {
  format: typeof OFFLINE_SALES_WORKBOOK_FORMAT;
  workbookId: string;
  factoryCode: "F01";
  operatorUserId: string;
  templateVersion: number;
  signingVersion: number;
  invoiceCapacity: 500;
  itemCapacity: 10_000;
  paymentCapacity: 2_000;
  issuedAt: string;
  snapshotSha256: string;
};

export type OfflineSalesReferenceSnapshot = {
  generatedAt: string;
  factoryWarehouseId: string;
  distributors: Array<{
    id: string;
    code: string;
    name: string;
    outstandingAmount: string;
    creditLimit: string;
    creditHold: boolean;
    /** Printed on the invoice. */
    address: string | null;
    city: string | null;
    mobile: string | null;
  }>;
  products: Array<{
    recipeId: string;
    productId: string;
    code: string;
    name: string;
    packsPerCarton: number;
    distributorCartonPrice: string;
    distributorPrices: Array<{ customerId: string; cartonPrice: string }>;
    retailPricePerPack: string;
    /** Carton price for retailers and walk-in sales (general rate). */
    generalCartonPrice: string;
    wacPerPack: string;
    stockUnits: number;
  }>;
  /** Salesmen whose salary a distributor may pay on an invoice. */
  salesmen: Array<{ employeeId: string; name: string }>;
  /** Existing non-distributor customers. */
  retailers: Array<{
    id: string;
    code: string;
    name: string;
    customerType: string;
    mobile: string | null;
    city: string | null;
    address: string | null;
    outstandingAmount: string;
  }>;
  discountRules: Array<{
    id: string;
    customerId: string;
    recipeId: string;
    quantityThreshold: number;
    freeCartons: number;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>;
  orders: Array<{
    id: string;
    orderBookerId: string;
    orderBookerCode: string;
    billNumber: number;
    shopkeeperName: string;
    shopkeeperMobile: string | null;
    shopkeeperAddress: string | null;
    items: Array<{
      recipeId: string;
      productCode: string;
      unitType: string;
      quantity: number;
      rate: string;
      cartonRate: string;
    }>;
  }>;
  wallets: Array<{
    id: string;
    code: string;
    name: string;
    type: "cash" | "bank";
  }>;
};

export type ParsedOfflineSalesItem = {
  worksheetRowNumber: number;
  invoiceNumber: string;
  productCode: string;
  cartonQuantity: number;
  looseUnitQuantity: number;
  packsPerCarton: number;
  baseCartonPrice: number;
  freeCartons: number;
  chargedUnits: number;
  dispatchedUnits: number;
  lineAmount: number;
  wacPerPack: number;
  stockUnitsSnapshot: number;
  physicalStockConfirmed: boolean;
  /** Cartons given free by hand, and a price changed from the list. */
  manualFreeCartons?: number;
  isPriceOverride?: boolean;
  listedCartonPrice?: number;
  sourceColumns: Record<string, string>;
};

export type ParsedOfflineSalesPayment = {
  worksheetRowNumber: number;
  invoiceNumber: string;
  method: "cash" | "bank_transfer" | "cheque" | "expense_offset";
  expenseType?: string | null;
  expenseEmployeeId?: string | null;
  amount: number;
  walletCode: string;
  reference: string | null;
  /** Bank and digital-account details, in the same wording the online form saves. */
  notes?: string | null;
  instantVerify?: boolean;
  chequeNumber: string | null;
  chequeBank: string | null;
  chequeDate: string | null;
  paymentDate: string;
  sourceColumns: Record<string, string>;
};

export type ParsedOfflineSalesInvoice = {
  worksheetRowNumber: number;
  recordToken: string;
  invoiceNumber: string;
  saleDate: string;
  saleTime: string;
  saleType: OfflineSalesSaleType;
  distributorCode: string | null;
  orderBookerCode: string | null;
  billNumber: number | null;
  paymentDueDate: string | null;
  remarks: string | null;
  /** Walk-in customer, discount, freight and cancellation, set by the offline desk. */
  customerDetails?: OfflineNewCustomer | null;
  invoiceDiscount?: number;
  invoiceDiscountDescription?: string | null;
  expenses?: number;
  expensesDescription?: string | null;
  /** Set when the operator cancelled a printed invoice at the desk. */
  cancelledReason?: string | null;
  /** The total on the paper copy, so the office can see if the system's total differs. */
  printedTotal?: number | null;
  invoiceAmount: number;
  paidAmount: number;
  pendingAmount: number;
  outstandingAmount: number;
  items: ParsedOfflineSalesItem[];
  payments: ParsedOfflineSalesPayment[];
  contentHash: string;
  parseIssues: Array<{
    code: string;
    message: string;
    source?: string;
    value?: string;
  }>;
};

export type ParsedOfflineSalesWorkbook = {
  manifest: OfflineSalesManifest;
  manifestSignature: string;
  snapshot: OfflineSalesReferenceSnapshot;
  snapshotSignature: string;
  fileSha256: string;
  invoices: ParsedOfflineSalesInvoice[];
};

export type OfflineSalesUploadResult = {
  batchId: string;
  fileSha256: string;
  status: "preview_ready" | "rejected";
  counts: {
    ready: number;
    warning: number;
    duplicate: number;
    invalid: number;
    needsReview: number;
  };
};

export type OfflineSalesBatchDetail = {
  batchId: string;
  status: OfflineSalesBatchStatus;
  filename: string;
  outageStartedAt: Date;
  outageEndedAt: Date;
  outageReason: string;
  uploadedAt: Date;
  counts: OfflineSalesUploadResult["counts"] & {
    total: number;
    posted: number;
    excluded: number;
  };
  invoices: Array<{
    stagedInvoiceId: string;
    invoiceNumber: string;
    status: OfflineSalesInvoiceStatus;
    worksheetRowNumber: number;
    saleType: OfflineSalesSaleType;
    customerDetails: OfflineNewCustomer | null;
    invoiceDiscount: string;
    expenses: string;
    businessDate: Date;
    distributorCode: string | null;
    customerName: string | null;
    orderBookerCode: string | null;
    billNumber: number | null;
    paymentDueDate: Date | null;
    remarks: string | null;
    invoiceAmount: string;
    paidAmount: string;
    pendingAmount: string;
    outstandingAmount: string;
    issueCodes: string[];
    issueDetails: Array<{
      code: string;
      message: string;
      source?: string;
      value?: string;
    }>;
    warningsAcknowledged: boolean;
    reviewResolution: string | null;
    postedInvoiceId: string | null;
    items: Array<{
      id: string;
      worksheetRowNumber: number;
      productCode: string;
      productName: string | null;
      cartonQuantity: number;
      looseUnitQuantity: number;
      packsPerCarton: number;
      freeCartons: number;
      manualFreeCartons: number;
      isPriceOverride: boolean;
      listedCartonPrice: string | null;
      baseCartonPrice: string;
      dispatchedUnits: number;
      lineAmount: string;
      stockUnitsSnapshot: number;
      physicalStockConfirmed: boolean;
      sourceColumns: Record<string, string>;
    }>;
    payments: Array<{
      id: string;
      worksheetRowNumber: number;
      method: "cash" | "bank_transfer" | "cheque" | "expense_offset";
      amount: string;
      walletCode: string;
      walletId: string | null;
      walletName: string | null;
      walletType: string | null;
      notes: string | null;
      instantVerify: boolean;
      reference: string | null;
      chequeNumber: string | null;
      chequeBank: string | null;
      paymentDate: Date;
      sourceColumns: Record<string, string>;
    }>;
    orderInvoiceCandidates: Array<{
      id: string;
      invoiceNumber: string;
      status: "saved" | "voided";
    }>;
  }>;
};

export type PostBatchResult = {
  batchId: string;
  status: OfflineSalesBatchStatus;
  posted: number;
  failed: number;
  remaining: number;
  hasMore: boolean;
};

export type OfflineSalesWorkbookSummary = {
  id: string;
  operatorUserId: string;
  operatorName: string;
  status: OfflineSalesWorkbookStatus;
  issuedAt: string;
  snapshotGeneratedAt: string;
  templateVersion: number;
  signingVersion: number;
  invoiceCapacity: number;
  usedSlots: number;
  remainingSlots: number;
  replacementWorkbookId: string | null;
  forceRetiredReason: string | null;
};
