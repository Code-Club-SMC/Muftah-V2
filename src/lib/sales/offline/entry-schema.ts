import { z } from "zod";
import {
  OFFLINE_SALES_INVOICE_CAPACITY,
  OFFLINE_SALES_MAX_ITEMS_PER_INVOICE,
} from "./constants";
import { OFFLINE_DESK_BACKUP_FORMAT } from "./desk-pack";

const text = (max: number) => z.string().trim().max(max);

export const offlineEntryItemSchema = z.object({
  productCode: text(100).min(1),
  cartonQuantity: z.number().int().min(0).max(1_000_000),
  looseUnitQuantity: z.number().int().min(0).max(1_000_000),
  physicalStockConfirmed: z.boolean(),
  manualFreeCartons: z.number().int().min(0).max(1_000_000).optional(),
  priceOverride: z.number().min(0).max(1_000_000_000).nullable().optional(),
});

export const offlineEntryPaymentSchema = z.object({
  method: z.enum(["cash", "bank_transfer", "cheque", "expense_offset"]),
  amount: z.number().positive().max(1_000_000_000),
  walletCode: text(100),
  expenseEmployeeId: text(100).nullable().optional(),
  reference: text(200).nullable(),
  chequeBank: text(200).nullable(),
  chequeNumber: text(100).nullable(),
  chequeDate: text(10).nullable(),
  paymentDate: text(10),
  instantVerify: z.boolean().optional(),
  digital: z
    .object({
      provider: text(100),
      senderMobile: text(100),
      senderTitle: text(200).nullable(),
    })
    .nullable()
    .optional(),
  bank: z
    .object({ senderBankName: text(200), senderAccountNumber: text(100) })
    .nullable()
    .optional(),
  notes: text(500).nullable().optional(),
});

export const offlineNewCustomerSchema = z.object({
  name: text(200),
  mobile: text(50).nullable(),
  city: text(100).nullable(),
  address: text(300).nullable(),
});

export const offlineEntrySchema = z.object({
  slotNumber: z.number().int().positive().max(OFFLINE_SALES_INVOICE_CAPACITY),
  recordToken: text(300).min(1),
  saleDate: text(10),
  saleTime: text(5),
  saleType: z.enum(["direct_distributor", "direct_retailer", "booked_order"]),
  distributorCode: text(100).nullable(),
  newCustomer: offlineNewCustomerSchema.nullable().optional(),
  orderBookerCode: text(100).nullable(),
  billNumber: z.number().int().positive().nullable(),
  paymentDueDate: text(10).nullable(),
  remarks: text(500).nullable(),
  invoiceDiscount: z.number().min(0).max(1_000_000_000).optional(),
  invoiceDiscountDescription: text(300).nullable().optional(),
  expenses: z.number().min(0).max(1_000_000_000).optional(),
  expensesDescription: text(300).nullable().optional(),
  cancelled: z
    .object({ reason: text(300).min(3), at: text(40) })
    .nullable()
    .optional(),
  printedTotal: z.number().min(0).max(1_000_000_000).optional(),
  items: z.array(offlineEntryItemSchema).max(OFFLINE_SALES_MAX_ITEMS_PER_INVOICE),
  payments: z.array(offlineEntryPaymentSchema).max(50),
});

export const offlineEntriesSchema = z
  .array(offlineEntrySchema)
  .min(1, "There are no invoices to send.")
  .max(OFFLINE_SALES_INVOICE_CAPACITY);

export const offlineBackupSchema = z.object({
  format: z.literal(OFFLINE_DESK_BACKUP_FORMAT),
  version: z.literal(1),
  workbookId: z.string().min(1),
  exportedAt: z.string(),
  entries: offlineEntriesSchema,
});
