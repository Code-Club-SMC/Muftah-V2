import { createHash } from "node:crypto";
import type {
  OfflineSalesManifest,
  OfflineSalesReferenceSnapshot,
  ParsedOfflineSalesInvoice,
  ParsedOfflineSalesWorkbook,
} from "./contracts";
import { calculateOfflineEntry, type OfflineEntry } from "./entry-calculator";
import { canonicalJson, hashOfflineSalesInvoice } from "./signing.server";

type Slot = { slotNumber: number; reservedSerial: number; recordToken: string };

/** Stable fingerprint of a set of entries, so sending the same set twice is a no-op. */
export function fingerprintOfflineEntries(workbookId: string, entries: OfflineEntry[]) {
  const sorted = [...entries].sort((a, b) => a.slotNumber - b.slotNumber);
  return createHash("sha256")
    .update(`titan-offline-sales-entries-v1\0${canonicalJson({ workbookId, entries: sorted })}`, "utf8")
    .digest("hex");
}

/**
 * Turns offline desk entries into the parsed shape that staging reads, so
 * classification, review and posting can run on them. Every amount is
 * recomputed here from the stored signed snapshot; nothing the browser says
 * about prices or totals is trusted.
 */
export function buildParsedWorkbookFromEntries(input: {
  manifest: OfflineSalesManifest;
  manifestSignature: string;
  snapshot: OfflineSalesReferenceSnapshot;
  snapshotSignature: string;
  slots: Slot[];
  entries: OfflineEntry[];
}): ParsedOfflineSalesWorkbook {
  const slotsByNumber = new Map(input.slots.map((slot) => [slot.slotNumber, slot]));
  const seen = new Set<number>();
  const invoices: ParsedOfflineSalesInvoice[] = [];

  for (const entry of [...input.entries].sort((a, b) => a.slotNumber - b.slotNumber)) {
    const slot = slotsByNumber.get(entry.slotNumber);
    if (!slot || slot.recordToken !== entry.recordToken) {
      throw new Error(`Invoice slot ${entry.slotNumber} was not issued by the system.`);
    }
    if (seen.has(entry.slotNumber)) {
      throw new Error(`Invoice slot ${entry.slotNumber} appears more than once.`);
    }
    seen.add(entry.slotNumber);

    const calculated = calculateOfflineEntry(entry, input.snapshot, slot.reservedSerial);
    const items = calculated.items.map((item, index) => ({
      ...item,
      worksheetRowNumber: index + 1,
      invoiceNumber: calculated.invoiceNumber,
      sourceColumns: { item: `Item ${index + 1}` },
    }));
    const payments = calculated.payments.map((payment, index) => ({
      ...payment,
      worksheetRowNumber: index + 1,
      invoiceNumber: calculated.invoiceNumber,
      sourceColumns: { payment: `Payment ${index + 1}` },
    }));
    const contentHash = hashOfflineSalesInvoice({
      recordToken: entry.recordToken,
      invoiceNumber: calculated.invoiceNumber,
      saleDate: entry.saleDate,
      saleTime: entry.saleTime,
      saleType: entry.saleType,
      distributorCode: entry.distributorCode,
      orderBookerCode: entry.orderBookerCode,
      billNumber: entry.billNumber,
      paymentDueDate: entry.paymentDueDate,
      remarks: entry.remarks,
      newCustomer: entry.saleType === "direct_retailer" ? (entry.newCustomer ?? null) : null,
      invoiceDiscount: calculated.invoiceDiscount,
      invoiceDiscountDescription: entry.invoiceDiscountDescription ?? null,
      expenses: calculated.expenses,
      expensesDescription: entry.expensesDescription ?? null,
      cancelled: entry.cancelled ?? null,
      items,
      payments,
      invoiceAmount: calculated.invoiceAmount,
      paidAmount: calculated.paidAmount,
      pendingAmount: calculated.pendingAmount,
      outstandingAmount: calculated.outstandingAmount,
    });
    invoices.push({
      worksheetRowNumber: entry.slotNumber,
      recordToken: entry.recordToken,
      invoiceNumber: calculated.invoiceNumber,
      saleDate: entry.saleDate,
      saleTime: entry.saleTime,
      saleType: entry.saleType,
      distributorCode: entry.distributorCode,
      orderBookerCode: entry.orderBookerCode,
      billNumber: entry.billNumber,
      paymentDueDate: entry.paymentDueDate,
      remarks: entry.remarks,
      customerDetails: entry.saleType === "direct_retailer" ? (entry.newCustomer ?? null) : null,
      invoiceDiscount: calculated.invoiceDiscount,
      invoiceDiscountDescription: entry.invoiceDiscountDescription ?? null,
      expenses: calculated.expenses,
      expensesDescription: entry.expensesDescription ?? null,
      cancelledReason: entry.cancelled?.reason ?? null,
      printedTotal: entry.printedTotal ?? null,
      invoiceAmount: calculated.invoiceAmount,
      paidAmount: calculated.paidAmount,
      pendingAmount: calculated.pendingAmount,
      outstandingAmount: calculated.outstandingAmount,
      items,
      payments,
      contentHash,
      parseIssues: calculated.issues,
    });
  }

  return {
    manifest: input.manifest,
    manifestSignature: input.manifestSignature,
    snapshot: input.snapshot,
    snapshotSignature: input.snapshotSignature,
    fileSha256: fingerprintOfflineEntries(input.manifest.workbookId, input.entries),
    invoices,
  };
}
