import type { OfflineSalesReferenceSnapshot } from "./contracts";
import type { OfflineCalcReference, OfflineEntry } from "./entry-calculator";

/**
 * What the browser keeps on the factory computer. Cost prices (WAC) and credit
 * limits stay on the server: the server prices every invoice from its own
 * signed snapshot, so the browser never needs them. Customer balances are kept
 * only so the printed invoice can show the previous balance, as the online one
 * does.
 */
type CalcProduct = OfflineCalcReference["products"][number];
type CalcOrder = OfflineCalcReference["orders"][number];

export type OfflineDeskReference = Omit<
  OfflineCalcReference,
  "distributors" | "retailers" | "products" | "orders" | "wallets"
> & {
  distributors: Array<{
    id: string;
    code: string;
    name: string;
    address?: string | null;
    city?: string | null;
    mobile?: string | null;
    outstandingAmount: string;
  }>;
  retailers: Array<{
    id: string;
    code: string;
    name: string;
    customerType: string;
    mobile: string | null;
    city: string | null;
    address?: string | null;
    outstandingAmount: string;
  }>;
  products: Array<CalcProduct & { name: string; retailPricePerPack: string }>;
  orders: Array<
    CalcOrder & {
      id: string;
      shopkeeperName: string;
      shopkeeperMobile: string | null;
      shopkeeperAddress: string | null;
    }
  >;
  wallets: Array<{ id: string; code: string; name: string; type: "cash" | "bank" }>;
  salesmen: Array<{ employeeId: string; name: string }>;
};

export type OfflineDeskSlot = {
  slotNumber: number;
  reservedSerial: number;
  recordToken: string;
};

export type OfflineDeskPack = {
  workbookId: string;
  operatorName: string;
  issuedAt: string;
  invoiceCapacity: number;
  reference: OfflineDeskReference;
  /** Only slots the server has not used yet. */
  slots: OfflineDeskSlot[];
};

export type OfflineDeskEntryStatus = "saved" | "printed" | "sent" | "cancelled";

export type OfflineDeskEntry = OfflineEntry & {
  workbookId: string;
  reservedSerial: number;
  invoiceNumber: string;
  invoiceAmount: number;
  customerName: string;
  status: OfflineDeskEntryStatus;
  savedAt: string;
  printedAt: string | null;
  sentAt: string | null;
  sentBatchId: string | null;
};

/** The file the operator can keep as a safety copy and upload from any computer. */
export type OfflineDeskBackup = {
  format: "titan-offline-sales-entries";
  version: 1;
  workbookId: string;
  exportedAt: string;
  entries: OfflineEntry[];
};

export const OFFLINE_DESK_BACKUP_FORMAT = "titan-offline-sales-entries" as const;

export function toDeskReference(snapshot: OfflineSalesReferenceSnapshot): OfflineDeskReference {
  return {
    generatedAt: snapshot.generatedAt,
    distributors: snapshot.distributors.map((value) => ({
      id: value.id,
      code: value.code,
      name: value.name,
      address: value.address ?? null,
      city: value.city ?? null,
      mobile: value.mobile ?? null,
      outstandingAmount: value.outstandingAmount,
    })),
    retailers: snapshot.retailers.map((value) => ({ ...value })),
    products: snapshot.products.map((value) => ({
      recipeId: value.recipeId,
      code: value.code,
      name: value.name,
      packsPerCarton: value.packsPerCarton,
      distributorCartonPrice: value.distributorCartonPrice,
      generalCartonPrice: value.generalCartonPrice,
      distributorPrices: value.distributorPrices,
      retailPricePerPack: value.retailPricePerPack,
      // Packs on the factory floor when the server built this copy. Lets the
      // desk warn before an invoice asks for more than exists.
      stockUnits: value.stockUnits,
    })),
    discountRules: snapshot.discountRules,
    orders: snapshot.orders.map((value) => ({
      id: value.id,
      orderBookerCode: value.orderBookerCode,
      billNumber: value.billNumber,
      shopkeeperName: value.shopkeeperName,
      shopkeeperMobile: value.shopkeeperMobile,
      shopkeeperAddress: value.shopkeeperAddress,
      items: value.items.map((item) => ({
        productCode: item.productCode,
        unitType: item.unitType,
        quantity: item.quantity,
        cartonRate: item.cartonRate,
      })),
    })),
    wallets: snapshot.wallets,
    salesmen: snapshot.salesmen,
  };
}
