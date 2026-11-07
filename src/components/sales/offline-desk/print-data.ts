import type { DistributorInvoiceData } from "@/components/sales/distributor-invoice";
import type { RetailerInvoiceData } from "@/components/sales/retailer-invoice";
import type { OfflineDeskEntry, OfflineDeskPack } from "@/lib/sales/offline/desk-pack";
import {
  calculateOfflineEntry,
  type CalculatedOfflineInvoice,
} from "@/lib/sales/offline/entry-calculator";

/**
 * Turns an offline invoice into the data the online invoice layouts expect, so
 * the customer gets the same paper whether the internet was up or not:
 * distributors get the distributor layout, everyone else the general one.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function longDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}-${MONTHS[Number(month) - 1] ?? month}-${year}`;
}

function shortDate(value: string) {
  const [year, month, day] = value.split("-");
  return `${day}-${month}-${year}`;
}

export type OfflinePrintData =
  | { kind: "distributor"; data: DistributorInvoiceData }
  | { kind: "general"; data: RetailerInvoiceData };

/** Who the invoice is for, and what they owed before this invoice. */
export function printCustomer(entry: OfflineDeskEntry, pack: OfflineDeskPack) {
  const { reference } = pack;
  if (entry.saleType === "direct_distributor") {
    const value = reference.distributors.find((row) => row.code === entry.distributorCode);
    return {
      name: value?.name ?? entry.customerName,
      address: value?.address ?? "",
      city: value?.city ?? "",
      mobile: value?.mobile ?? "",
      openingBalance: Number(value?.outstandingAmount ?? 0),
    };
  }
  if (entry.saleType === "direct_retailer") {
    if (entry.newCustomer) {
      return {
        name: entry.newCustomer.name,
        address: entry.newCustomer.address ?? "",
        city: entry.newCustomer.city ?? "",
        mobile: entry.newCustomer.mobile ?? "",
        openingBalance: 0,
      };
    }
    const value = reference.retailers.find((row) => row.code === entry.distributorCode);
    return {
      name: value?.name ?? entry.customerName,
      address: value?.address ?? "",
      city: value?.city ?? "",
      mobile: value?.mobile ?? "",
      openingBalance: Number(value?.outstandingAmount ?? 0),
    };
  }
  const order = reference.orders.find(
    (row) => row.orderBookerCode === entry.orderBookerCode && row.billNumber === entry.billNumber,
  );
  return {
    name: order?.shopkeeperName ?? entry.customerName,
    address: order?.shopkeeperAddress ?? "",
    city: "",
    mobile: order?.shopkeeperMobile ?? "",
    openingBalance: 0,
  };
}

function sameCustomer(a: OfflineDeskEntry, b: OfflineDeskEntry) {
  if (a.saleType !== b.saleType) return false;
  if (a.distributorCode) return a.distributorCode === b.distributorCode;
  if (a.newCustomer && b.newCustomer) {
    return (
      a.newCustomer.name.trim().toLowerCase() === b.newCustomer.name.trim().toLowerCase() &&
      (a.newCustomer.mobile ?? "") === (b.newCustomer.mobile ?? "")
    );
  }
  return false;
}

/**
 * Balance before this invoice: what the customer owed when the computer was
 * prepared, plus what earlier desk invoices to the same customer left unpaid.
 */
export function previousBalanceFor(
  entry: OfflineDeskEntry,
  pack: OfflineDeskPack,
  allEntries: OfflineDeskEntry[],
) {
  const opening = printCustomer(entry, pack).openingBalance;
  const earlier = allEntries.filter(
    (other) =>
      other.workbookId === entry.workbookId &&
      other.reservedSerial < entry.reservedSerial &&
      other.status !== "cancelled" &&
      sameCustomer(entry, other),
  );
  const owed = earlier.reduce((total, other) => {
    const calculated = calculateOfflineEntry(other, pack.reference, other.reservedSerial);
    return total + calculated.outstandingAmount;
  }, 0);
  return Math.round((opening + owed) * 100) / 100;
}

function quantityLabel(item: CalculatedOfflineInvoice["items"][number], additive: boolean) {
  const parts: string[] = [];
  if (item.cartonQuantity > 0 || item.freeCartons > 0) {
    const billedPacks = item.cartonQuantity * item.packsPerCarton;
    const freePacks = item.freeCartons * item.packsPerCarton;
    if (item.freeCartons > 0) {
      parts.push(`${item.cartonQuantity}+${item.freeCartons} Cartons (${billedPacks + freePacks} Packs)`);
    } else if (item.manualFreeCartons > 0 && !additive) {
      // For a retailer the free cartons are part of the cartons entered.
      parts.push(`${item.cartonQuantity} Cartons incl. ${item.manualFreeCartons} free (${billedPacks} Packs)`);
    } else if (item.manualFreeCartons > 0) {
      parts.push(`${item.cartonQuantity}+${item.manualFreeCartons} Cartons (${billedPacks + item.manualFreeCartons * item.packsPerCarton} Packs)`);
    } else {
      parts.push(`${item.cartonQuantity} Cartons (${billedPacks} Packs)`);
    }
  }
  if (item.looseUnitQuantity > 0) parts.push(`${item.looseUnitQuantity} Packs`);
  return parts.join(" + ");
}

export function buildOfflinePrintData(
  entry: OfflineDeskEntry,
  pack: OfflineDeskPack,
  allEntries: OfflineDeskEntry[],
): OfflinePrintData {
  const calculated = calculateOfflineEntry(entry, pack.reference, entry.reservedSerial);
  const customer = printCustomer(entry, pack);
  const productName = (code: string) =>
    pack.reference.products.find((value) => value.code === code)?.name ?? code;

  if (entry.saleType === "direct_distributor") {
    return {
      kind: "distributor",
      data: {
        companyName: "IIPL",
        docType: "Sales Estimate",
        party: {
          name: customer.name,
          address: customer.address || "N/A",
          city: customer.city || "N/A",
          tel: customer.mobile || "N/A",
          mob: "",
        },
        date: longDate(entry.saleDate),
        estNo: entry.invoiceNumber,
        docNo: entry.invoiceNumber,
        pvNo: "—",
        mBillNo: entry.invoiceNumber,
        transporter: "Factory F01",
        biltyNo: "—",
        dispDate: `disp ${shortDate(entry.saleDate)}`,
        items: calculated.items.map((item, index) => ({
          serialNo: index + 1,
          itemCode: "",
          itemDescription: productName(item.productCode),
          cartonQty: `${item.cartonQuantity}-${item.looseUnitQuantity}`,
          schemeCarton: `${item.freeCartons + item.manualFreeCartons}-0`,
          cartonRate: item.baseCartonPrice,
          margin: 0,
          marginAmount: 0,
          grossAmount: item.lineAmount,
          discount: 0,
          netAmount: item.lineAmount,
        })),
        freight: calculated.expenses,
        previousBalance: previousBalanceFor(entry, pack, allEntries),
        invoiceAmount: calculated.invoiceAmount,
      },
    };
  }

  return {
    kind: "general",
    data: {
      invoiceNo: entry.invoiceNumber,
      date: longDate(entry.saleDate),
      customer: {
        name: customer.name,
        completeAddress: [customer.address, customer.city].filter(Boolean).join(", ") || "N/A",
        phoneNumber: customer.mobile || "N/A",
      },
      saleType: "Retail",
      items: calculated.items.map((item, index) => ({
        sNo: index + 1,
        productName: productName(item.productCode),
        hsnCode: "—",
        gstRate: 0,
        rate: item.baseCartonPrice,
        qty: quantityLabel(item, false),
        // Before any free cartons, as the online general layout shows it.
        grossAmount:
          Math.round(
            (item.cartonQuantity * item.baseCartonPrice +
              item.looseUnitQuantity * (item.baseCartonPrice / item.packsPerCarton)) *
              100,
          ) / 100,
        netAmount: item.lineAmount,
      })),
      cgstRate: 0,
      sgstRate: 0,
      invoiceDiscount: calculated.invoiceDiscount,
      bookedOrderNo: entry.saleType === "booked_order" ? (entry.billNumber ?? undefined) : undefined,
    },
  };
}
