import {
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
} from "@zip.js/zip.js";
import { describe, expect, it } from "vitest";
import { inspectSafeXlsxPackage } from "@/lib/offline-xlsx/ooxml-guard.server";
import {
  OFFLINE_SALES_INVOICE_CAPACITY,
  OFFLINE_SALES_MAX_BYTES,
  OFFLINE_SALES_ZIP_MAX_ENTRIES,
  OFFLINE_SALES_ZIP_MAX_ENTRY_BYTES,
  OFFLINE_SALES_ZIP_MAX_TOTAL_BYTES,
} from "./constants";
import type { OfflineSalesWorkbookTemplateInput } from "./contracts";
import {
  buildOfflineSalesWorkbook,
  OFFLINE_SALES_INVOICE_HEADERS,
  OFFLINE_SALES_ITEM_HEADERS,
  OFFLINE_SALES_PAYMENT_HEADERS,
} from "./workbook-template.server";

function fixture(): OfflineSalesWorkbookTemplateInput {
  return {
    manifest: {
      format: "titan-offline-sales",
      workbookId: "workbook-1",
      factoryCode: "F01",
      operatorUserId: "operator-1",
      templateVersion: 1,
      signingVersion: 1,
      invoiceCapacity: 500,
      itemCapacity: 10_000,
      paymentCapacity: 2_000,
      issuedAt: "2026-08-10T08:00:00.000Z",
      snapshotSha256: "a".repeat(64),
    },
    manifestSignature: "manifest-signature",
    snapshotSignature: "snapshot-signature",
    operatorName: "Factory Operator",
    slots: Array.from({ length: OFFLINE_SALES_INVOICE_CAPACITY }, (_, index) => ({
      id: `slot-${index + 1}`,
      slotNumber: index + 1,
      reservedSerial: index + 100,
      recordToken: `token-${index + 1}`,
    })),
    snapshot: {
      generatedAt: "2026-08-10T08:00:00.000Z",
      factoryWarehouseId: "warehouse-1",
      distributors: [
        {
          id: "customer-1",
          code: "D-1",
          name: "Demo Distributor",
          outstandingAmount: "0.00",
          creditLimit: "100000.00",
          creditHold: false,
        },
      ],
      products: [
        {
          recipeId: "recipe-1",
          productId: "product-1",
          code: "recipe-1",
          name: "Demo Product — 1L",
          packsPerCarton: 12,
          distributorCartonPrice: "1200.00",
          distributorPrices: [
            { customerId: "customer-1", cartonPrice: "1100.00" },
          ],
          retailPricePerPack: "120.00",
          wacPerPack: "50.0000",
          stockUnits: 120,
        },
      ],
      discountRules: [],
      orders: [
        {
          id: "order-1",
          orderBookerId: "booker-1",
          orderBookerCode: "booker-1",
          billNumber: 7,
          shopkeeperName: "Demo Shop",
          shopkeeperMobile: null,
          shopkeeperAddress: null,
          items: [
            {
              recipeId: "recipe-1",
              productCode: "recipe-1",
              unitType: "full_carton",
              quantity: 2,
              rate: "1200.00",
              cartonRate: "1200.00",
            },
          ],
        },
      ],
      wallets: [
        { id: "cash-1", code: "cash-1", name: "Cash", type: "cash" },
        { id: "bank-1", code: "bank-1", name: "Bank", type: "bank" },
      ],
    },
  };
}

async function parts(bytes: Uint8Array) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  try {
    const entries = await reader.getEntries();
    const result = new Map<string, string>();
    for (const entry of entries) {
      if (entry.directory) continue;
      result.set(
        entry.filename,
        new TextDecoder().decode(await entry.getData(new Uint8ArrayWriter())),
      );
    }
    return result;
  } finally {
    await reader.close().catch(() => undefined);
  }
}

describe("offline sales workbook template", () => {
  it("creates exactly five guarded sheets at the approved capacities", async () => {
    const bytes = await buildOfflineSalesWorkbook(fixture());
    expect(bytes.byteLength).toBeGreaterThanOrEqual(1024 * 1024);
    expect(bytes.byteLength).toBeLessThanOrEqual(OFFLINE_SALES_MAX_BYTES);
    await expect(
      inspectSafeXlsxPackage(bytes, {
        maxBytes: OFFLINE_SALES_MAX_BYTES,
        maxEntries: OFFLINE_SALES_ZIP_MAX_ENTRIES,
        maxEntryBytes: OFFLINE_SALES_ZIP_MAX_ENTRY_BYTES,
        maxTotalBytes: OFFLINE_SALES_ZIP_MAX_TOTAL_BYTES,
      }),
    ).resolves.toBeUndefined();

    const files = await parts(bytes);
    const workbook = files.get("xl/workbook.xml") ?? "";
    expect(workbook.match(/<sheet /g)).toHaveLength(5);
    expect(workbook).toContain('name="Invoices"');
    expect(workbook).toContain('name="Items"');
    expect(workbook).toContain('name="Payments"');
    expect(workbook).toContain('name="Reference Data"');
    expect(workbook).toContain('name="Print Invoice"');
    expect(files.get("xl/worksheets/sheet1.xml")).toContain(
      '<dimension ref="A1:L501"/>',
    );
    expect(files.get("xl/worksheets/sheet2.xml")).toContain(
      '<dimension ref="A1:M10001"/>',
    );
    expect(files.get("xl/worksheets/sheet3.xml")).toContain(
      '<dimension ref="A1:I2001"/>',
    );
  }, 30_000);

  it("locks identities and calculations while unlocking input cells", async () => {
    const files = await parts(await buildOfflineSalesWorkbook(fixture()));
    const invoices = files.get("xl/worksheets/sheet1.xml") ?? "";
    const items = files.get("xl/worksheets/sheet2.xml") ?? "";
    const styles = files.get("xl/styles.xml") ?? "";

    expect(invoices).toContain('<c r="A2" s="4"><v>1</v></c>');
    expect(invoices).toContain('<c r="E2" s="2"/>');
    expect(invoices).toContain("OFF-F01-");
    expect(invoices).toContain("TEXT(E2,&quot;yyyymmdd&quot;)");
    expect(items).toContain("Physical Stock Confirmed");
    expect(items).toContain("AGGREGATE(14,6");
    expect(items).toContain("FLOOR(C2/");
    expect(styles).toContain('<protection locked="0"/>');
    expect(styles).toContain('<protection locked="1" hidden="1"/>');
    expect(invoices).toContain("direct_distributor,booked_order");
    expect(items).toContain("YES,NO");
  }, 30_000);

  it("keeps exact entry headers and provides the two approved print variants", async () => {
    expect(OFFLINE_SALES_INVOICE_HEADERS).toHaveLength(12);
    expect(OFFLINE_SALES_ITEM_HEADERS).toHaveLength(13);
    expect(OFFLINE_SALES_PAYMENT_HEADERS).toHaveLength(9);

    const files = await parts(await buildOfflineSalesWorkbook(fixture()));
    const print = files.get("xl/worksheets/sheet5.xml") ?? "";
    const workbook = files.get("xl/workbook.xml") ?? "";
    expect(print).toContain("Customer Signature");
    expect(print).toContain("Account Signature");
    expect(print).toContain('=&quot;booked_order&quot;');
    expect(print).toContain("SUMIF(Items!");
    expect(print).toContain("Pending Verification");
    expect(print).toContain('&quot;cash&quot;');
    expect(workbook).toContain("_xlnm.Print_Area");
    expect(workbook).toContain("AGGREGATE(14,6");
  }, 30_000);
});
