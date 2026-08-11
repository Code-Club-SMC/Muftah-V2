import type {
  OfflineSalesBatchStatus,
  OfflineSalesInvoiceStatus,
  OfflineSalesWorkbookStatus,
} from "@/db/schemas/offline-sales-schema";

export const OFFLINE_SALES_WORKBOOK_FORMAT = "titan-offline-sales" as const;
export const OFFLINE_SALES_XLSX_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" as const;

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
    wacPerPack: string;
    stockUnits: number;
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

export type OfflineSalesSlotTemplate = {
  id: string;
  slotNumber: number;
  reservedSerial: number;
  recordToken: string;
};

export type OfflineSalesWorkbookTemplateInput = {
  manifest: OfflineSalesManifest;
  manifestSignature: string;
  snapshot: OfflineSalesReferenceSnapshot;
  snapshotSignature: string;
  operatorName: string;
  slots: OfflineSalesSlotTemplate[];
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
  sourceColumns: Record<string, string>;
};

export type ParsedOfflineSalesPayment = {
  worksheetRowNumber: number;
  invoiceNumber: string;
  method: "cash" | "bank_transfer" | "cheque";
  amount: number;
  walletCode: string;
  reference: string | null;
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
  saleType: "direct_distributor" | "booked_order";
  distributorCode: string | null;
  orderBookerCode: string | null;
  billNumber: number | null;
  paymentDueDate: string | null;
  remarks: string | null;
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
    saleType: "direct_distributor" | "booked_order";
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
      dispatchedUnits: number;
      lineAmount: string;
      stockUnitsSnapshot: number;
      physicalStockConfirmed: boolean;
      sourceColumns: Record<string, string>;
    }>;
    payments: Array<{
      id: string;
      worksheetRowNumber: number;
      method: "cash" | "bank_transfer" | "cheque";
      amount: string;
      walletCode: string;
      walletId: string | null;
      walletName: string | null;
      walletType: string | null;
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

function safeFilenamePart(value: string) {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[.-]+|[.-]+$/g, "")
      .slice(0, 80) || "unknown"
  );
}

export function offlineSalesDownloadHeaders(input: {
  workbookId: string;
}) {
  const filename = `offline-sales-F01-${safeFilenamePart(input.workbookId)}.xlsx`;
  return {
    "Content-Type": OFFLINE_SALES_XLSX_CONTENT_TYPE,
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  } as const;
}
