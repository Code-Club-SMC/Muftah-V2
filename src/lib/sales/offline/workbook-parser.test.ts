import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OFFLINE_SALES_INVOICE_CAPACITY,
  OFFLINE_SALES_TEMPLATE_VERSION,
} from "./constants";
import type {
  OfflineSalesManifest,
  OfflineSalesReferenceSnapshot,
  OfflineSalesWorkbookTemplateInput,
} from "./contracts";
import {
  createOfflineSalesSlotToken,
  hashOfflineSalesSnapshot,
  signOfflineSalesManifest,
  signOfflineSalesSnapshot,
} from "./signing.server";
import { parseOfflineSalesWorkbook } from "./workbook-parser.server";
import { buildOfflineSalesWorkbook } from "./workbook-template.server";

const TEST_KEY = Buffer.alloc(32, 41).toString("base64");
const snapshot: OfflineSalesReferenceSnapshot = {
  generatedAt: "2026-08-10T08:00:00.000Z",
  factoryWarehouseId: "warehouse-1",
  distributors: [{
    id: "customer-1", code: "D-1", name: "Demo Distributor",
    outstandingAmount: "0.00", creditLimit: "100000.00", creditHold: false,
  }],
  products: [{
    recipeId: "recipe-1", productId: "product-1", code: "recipe-1",
    name: "Demo Product", packsPerCarton: 12,
    distributorCartonPrice: "1200.00",
    distributorPrices: [{ customerId: "customer-1", cartonPrice: "1100.00" }],
    retailPricePerPack: "120.00", wacPerPack: "50.0000", stockUnits: 200,
  }],
  discountRules: [{
    id: "rule-1", customerId: "customer-1", recipeId: "recipe-1",
    quantityThreshold: 5, freeCartons: 1,
    effectiveFrom: "2026-01-01T00:00:00.000Z", effectiveTo: null,
  }],
  orders: [],
  wallets: [
    { id: "cash-1", code: "cash-1", name: "Cash", type: "cash" },
    { id: "bank-1", code: "bank-1", name: "Bank", type: "bank" },
  ],
};

function fixture(): OfflineSalesWorkbookTemplateInput {
  const manifest: OfflineSalesManifest = {
    format: "titan-offline-sales", workbookId: "workbook-parser",
    factoryCode: "F01", operatorUserId: "operator-1",
    templateVersion: OFFLINE_SALES_TEMPLATE_VERSION, signingVersion: 1,
    invoiceCapacity: 500, itemCapacity: 10_000, paymentCapacity: 2_000,
    issuedAt: snapshot.generatedAt, snapshotSha256: hashOfflineSalesSnapshot(snapshot),
  };
  return {
    manifest,
    manifestSignature: signOfflineSalesManifest(manifest),
    snapshot,
    snapshotSignature: signOfflineSalesSnapshot(snapshot, 1),
    operatorName: "Operator",
    slots: Array.from({ length: OFFLINE_SALES_INVOICE_CAPACITY }, (_, index) => {
      const slotNumber = index + 1;
      const reservedSerial = index + 100;
      return {
        id: `slot-${slotNumber}`, slotNumber, reservedSerial,
        recordToken: createOfflineSalesSlotToken({
          workbookId: manifest.workbookId,
          operatorUserId: manifest.operatorUserId,
          templateVersion: manifest.templateVersion,
          signingVersion: manifest.signingVersion,
          slotNumber,
          reservedSerial,
        }),
      };
    }),
  };
}

async function rewrite(bytes: Uint8Array, mutate: (parts: Map<string, string>) => void) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  const parts = new Map<string, string>();
  try {
    for (const entry of await reader.getEntries()) {
      if (entry.directory) continue;
      parts.set(entry.filename, new TextDecoder().decode(await entry.getData(new Uint8ArrayWriter())));
    }
  } finally {
    await reader.close().catch(() => undefined);
  }
  mutate(parts);
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [name, content] of parts) await writer.add(name, new TextReader(content));
  return await writer.close();
}

function replaceCell(xml: string, ref: string, replacement: string) {
  const pattern = new RegExp(`<c r="${ref}"[^>]*/>|<c r="${ref}"[^>]*>.*?</c>`);
  if (!pattern.test(xml)) throw new Error(`Missing ${ref}`);
  return xml.replace(pattern, replacement);
}

function textCell(ref: string, style: number, value: string) {
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t>${value}</t></is></c>`;
}

function numberCell(ref: string, style: number, value: number) {
  return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
}

describe("offline sales workbook parser", () => {
  const original = {
    enabled: process.env.OFFLINE_SALES_IMPORT_ENABLED,
    keys: process.env.OFFLINE_SALES_SIGNING_KEYS,
    version: process.env.OFFLINE_SALES_ACTIVE_SIGNING_VERSION,
  };
  let base: Uint8Array;

  beforeAll(async () => {
    process.env.OFFLINE_SALES_IMPORT_ENABLED = "true";
    process.env.OFFLINE_SALES_SIGNING_KEYS = JSON.stringify({ "1": TEST_KEY });
    process.env.OFFLINE_SALES_ACTIVE_SIGNING_VERSION = "1";
    base = await buildOfflineSalesWorkbook(fixture());
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(original)) {
      const name = key === "enabled" ? "OFFLINE_SALES_IMPORT_ENABLED" : key === "keys" ? "OFFLINE_SALES_SIGNING_KEYS" : "OFFLINE_SALES_ACTIVE_SIGNING_VERSION";
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("accepts an untouched official workbook", async () => {
    const parsed = await parseOfflineSalesWorkbook(base);
    expect(parsed.manifest.workbookId).toBe("workbook-parser");
    expect(parsed.invoices).toEqual([]);
    expect(parsed.fileSha256).toMatch(/^[a-f0-9]{64}$/);
  }, 30_000);

  it("recalculates a direct invoice and mixed payment from signed data", async () => {
    const invoiceNumber = "OFF-F01-20260810-100";
    const bytes = await rewrite(base, (parts) => {
      let invoices = parts.get("xl/worksheets/sheet1.xml") ?? "";
      invoices = replaceCell(invoices, "E2", textCell("E2", 2, "2026-08-10"));
      invoices = replaceCell(invoices, "F2", textCell("F2", 3, "12:30"));
      invoices = replaceCell(invoices, "G2", textCell("G2", 1, "direct_distributor"));
      invoices = replaceCell(invoices, "H2", textCell("H2", 1, "D-1"));
      invoices = replaceCell(invoices, "K2", textCell("K2", 2, "2026-08-20"));
      parts.set("xl/worksheets/sheet1.xml", invoices);

      let items = parts.get("xl/worksheets/sheet2.xml") ?? "";
      items = replaceCell(items, "A2", textCell("A2", 1, invoiceNumber));
      items = replaceCell(items, "B2", textCell("B2", 1, "recipe-1"));
      items = replaceCell(items, "C2", numberCell("C2", 7, 10));
      items = replaceCell(items, "D2", numberCell("D2", 7, 0));
      items = replaceCell(items, "E2", textCell("E2", 1, "YES"));
      parts.set("xl/worksheets/sheet2.xml", items);

      let payments = parts.get("xl/worksheets/sheet3.xml") ?? "";
      payments = replaceCell(payments, "A2", textCell("A2", 1, invoiceNumber));
      payments = replaceCell(payments, "B2", textCell("B2", 1, "cash"));
      payments = replaceCell(payments, "C2", numberCell("C2", 7, 500));
      payments = replaceCell(payments, "D2", textCell("D2", 1, "cash-1"));
      payments = replaceCell(payments, "I2", textCell("I2", 2, "2026-08-10"));
      payments = replaceCell(payments, "A3", textCell("A3", 1, invoiceNumber));
      payments = replaceCell(payments, "B3", textCell("B3", 1, "bank_transfer"));
      payments = replaceCell(payments, "C3", numberCell("C3", 7, 1000));
      payments = replaceCell(payments, "D3", textCell("D3", 1, "bank-1"));
      payments = replaceCell(payments, "E3", textCell("E3", 1, "TRX-1"));
      payments = replaceCell(payments, "I3", textCell("I3", 2, "2026-08-10"));
      parts.set("xl/worksheets/sheet3.xml", payments);
    });
    const [invoice] = (await parseOfflineSalesWorkbook(bytes)).invoices;
    expect(invoice.parseIssues).toEqual([]);
    expect(invoice).toMatchObject({
      invoiceNumber, invoiceAmount: 11_000, paidAmount: 500,
      pendingAmount: 1_000, outstandingAmount: 10_500,
    });
    expect(invoice.items[0]).toMatchObject({
      baseCartonPrice: 1_100, freeCartons: 2,
      chargedUnits: 120, dispatchedUnits: 144,
    });
  }, 30_000);

  it.each([
    ["edited token", "xl/worksheets/sheet1.xml", (xml: string) => replaceCell(xml, "C2", textCell("C2", 4, "fake"))],
    ["formula in input", "xl/worksheets/sheet1.xml", (xml: string) => replaceCell(xml, "E2", '<c r="E2" s="2"><f>TODAY()</f><v>1</v></c>')],
    ["edited protected formula", "xl/worksheets/sheet2.xml", (xml: string) => xml.replace("ROUND(C2*G2", "ROUND(C2*G2+1")],
    ["edited signed price", "xl/worksheets/sheet4.xml", (xml: string) => xml.replace("1100.00", "999.00")],
  ])("rejects %s", async (_name, part, mutate) => {
    const bytes = await rewrite(base, (parts) => parts.set(part, mutate(parts.get(part) ?? "")));
    await expect(parseOfflineSalesWorkbook(bytes)).rejects.toThrow();
  }, 30_000);

  it("rejects orphan item rows", async () => {
    const bytes = await rewrite(base, (parts) => {
      let items = parts.get("xl/worksheets/sheet2.xml") ?? "";
      items = replaceCell(items, "A2", textCell("A2", 1, "OFF-UNKNOWN"));
      items = replaceCell(items, "B2", textCell("B2", 1, "recipe-1"));
      items = replaceCell(items, "C2", numberCell("C2", 7, 1));
      parts.set("xl/worksheets/sheet2.xml", items);
    });
    await expect(parseOfflineSalesWorkbook(bytes)).rejects.toThrow("does not link");
  }, 30_000);
});
