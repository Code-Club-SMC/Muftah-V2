import { randomInt } from "node:crypto";
import { createId } from "@paralleldrive/cuid2";
import {
  TextReader,
  Uint8ArrayReader,
  Uint8ArrayWriter,
  ZipReader,
  ZipWriter,
} from "@zip.js/zip.js";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type {
  OfflineSalesManifest,
  OfflineSalesReferenceSnapshot,
} from "./contracts";
import { OFFLINE_SALES_INVOICE_CAPACITY } from "./constants";
import {
  createOfflineSalesSlotToken,
  hashOfflineSalesSnapshot,
  signOfflineSalesManifest,
  signOfflineSalesSnapshot,
} from "./signing.server";
import { parseOfflineSalesWorkbook } from "./workbook-parser.server";
import { buildOfflineSalesWorkbook } from "./workbook-template.server";

const integrationEnabled = process.env.OFFLINE_SALES_RUN_DB_TESTS === "true";

async function rewrite(
  bytes: Uint8Array,
  mutate: (parts: Map<string, string>) => void,
) {
  const reader = new ZipReader(new Uint8ArrayReader(bytes));
  const parts = new Map<string, string>();
  try {
    for (const entry of await reader.getEntries()) {
      if (entry.directory) continue;
      parts.set(
        entry.filename,
        new TextDecoder().decode(await entry.getData(new Uint8ArrayWriter())),
      );
    }
  } finally {
    await reader.close().catch(() => undefined);
  }
  mutate(parts);
  const writer = new ZipWriter(new Uint8ArrayWriter());
  for (const [name, content] of parts) {
    await writer.add(name, new TextReader(content));
  }
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

describe.runIf(integrationEnabled)(
  "offline sales PostgreSQL integration",
  () => {
    it("stages and posts a signed shortage invoice with mixed payments", async () => {
      const {
        customers,
        db,
        finishedGoodsStock,
        invoices,
        offlineSalesImportBatches,
        offlineSalesInvoiceSlots,
        offlineSalesStagedInvoices,
        offlineSalesWorkbooks,
        packagingMaterials,
        payments,
        products,
        recipes,
        stockReconciliationIssues,
        user,
        wallets,
        warehouses,
      } = await import("@/db");
      const { stageOfflineSalesUpload } =
        await import("@/server-functions/sales/offline-upload-fn");
      const { postOfflineSalesBatch } = await import("./posting.server");
      const runId = createId();
      const actorId = `it-offline-user-${runId}`;
      const warehouseId = `it-offline-warehouse-${runId}`;
      const productId = `it-offline-product-${runId}`;
      const packagingId = `it-offline-packaging-${runId}`;
      const recipeId = `it-offline-recipe-${runId}`;
      const customerId = `it-offline-customer-${runId}`;
      const cashWalletId = `it-offline-cash-${runId}`;
      const bankWalletId = `it-offline-bank-${runId}`;
      const workbookId = `it-offline-workbook-${runId}`;
      const reservedSerial = randomInt(1_000_000, 2_000_000_000);

      const storageColumns = await db.execute(sql`
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (
          table_name LIKE 'offline_sales_%'
          OR table_name = 'stock_reconciliation_issues'
        )
      ORDER BY table_name, ordinal_position
    `);
      expect(storageColumns.rows.length).toBeGreaterThan(0);
      expect(storageColumns.rows).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ data_type: "bytea" }),
        ]),
      );
      const forbiddenContentColumns = new Set([
        "blob",
        "content",
        "document",
        "document_bytes",
        "file_bytes",
        "workbook_bytes",
      ]);
      expect(
        storageColumns.rows.filter((column) =>
          forbiddenContentColumns.has(String(column.column_name)),
        ),
      ).toEqual([]);

      await db.insert(user).values({
        id: actorId,
        name: "Offline Integration Operator",
        email: `${runId}@offline.integration.test`,
        emailVerified: true,
      });
      await db.insert(warehouses).values({
        id: warehouseId,
        name: `Offline Factory ${runId}`,
        address: "Integration test",
        city: "Lahore",
        state: "Punjab",
        type: "factory_floor",
        latitude: "31.52040000",
        longitude: "74.35870000",
      });
      await db.insert(products).values({ id: productId, name: "Test Cleaner" });
      await db.insert(packagingMaterials).values({
        id: packagingId,
        name: `Test Bottle ${runId}`,
        type: "primary",
      });
      await db.insert(recipes).values({
        id: recipeId,
        productId,
        name: "Test Cleaner 1L",
        batchSize: "100.00",
        containerType: "pack",
        containerPackagingId: packagingId,
        fillAmount: "1000.000",
        fillUnit: "ml",
        containersPerCarton: 12,
        estimatedCostPerContainer: "50.0000",
      });
      const [customer] = await db
        .insert(customers)
        .values({
          id: customerId,
          name: "Test Distributor",
          customerType: "distributor",
          creditLimit: "100000.00",
        })
        .returning({ sNo: customers.sNo });
      if (!customer) throw new Error("Integration customer was not created");
      await db.insert(finishedGoodsStock).values({
        warehouseId,
        recipeId,
        quantityCartons: 1,
        quantityContainers: 0,
        weightedAverageCostPerPack: "50.0000",
        weightedAverageCostPerCarton: "600.0000",
        totalInventoryValue: "600.00",
      });
      await db.insert(wallets).values([
        { id: cashWalletId, name: "Test Cash", type: "cash" },
        { id: bankWalletId, name: "Test Bank", type: "bank" },
      ]);

      const snapshot: OfflineSalesReferenceSnapshot = {
        generatedAt: "2026-08-09T07:00:00.000Z",
        factoryWarehouseId: warehouseId,
        distributors: [
          {
            id: customerId,
            code: `D-${customer.sNo}`,
            name: "Test Distributor",
            outstandingAmount: "0.00",
            creditLimit: "100000.00",
            creditHold: false,
          },
        ],
        products: [
          {
            recipeId,
            productId,
            code: recipeId,
            name: "Test Cleaner — Test Cleaner 1L",
            packsPerCarton: 12,
            distributorCartonPrice: "1200.00",
            distributorPrices: [{ customerId, cartonPrice: "1100.00" }],
            retailPricePerPack: "120.00",
            wacPerPack: "50.0000",
            stockUnits: 12,
          },
        ],
        discountRules: [],
        orders: [],
        wallets: [
          {
            id: cashWalletId,
            code: cashWalletId,
            name: "Test Cash",
            type: "cash",
          },
          {
            id: bankWalletId,
            code: bankWalletId,
            name: "Test Bank",
            type: "bank",
          },
        ],
      };
      const manifest: OfflineSalesManifest = {
        format: "titan-offline-sales",
        workbookId,
        factoryCode: "F01",
        operatorUserId: actorId,
        templateVersion: 1,
        signingVersion: 1,
        invoiceCapacity: 500,
        itemCapacity: 10_000,
        paymentCapacity: 2_000,
        issuedAt: snapshot.generatedAt,
        snapshotSha256: hashOfflineSalesSnapshot(snapshot),
      };
      const slots = Array.from(
        { length: OFFLINE_SALES_INVOICE_CAPACITY },
        (_, index) => {
          const slotNumber = index + 1;
          const serial = reservedSerial + index;
          return {
            id: `it-offline-slot-${runId}-${slotNumber}`,
            slotNumber,
            reservedSerial: serial,
            recordToken: createOfflineSalesSlotToken({
              workbookId,
              operatorUserId: actorId,
              templateVersion: 1,
              signingVersion: 1,
              slotNumber,
              reservedSerial: serial,
            }),
          };
        },
      );
      const manifestSignature = signOfflineSalesManifest(manifest);
      const snapshotSignature = signOfflineSalesSnapshot(snapshot, 1);
      await db.insert(offlineSalesWorkbooks).values({
        id: workbookId,
        factoryCode: "F01",
        operatorUserId: actorId,
        issuedByUserId: actorId,
        status: "closed",
        templateVersion: 1,
        signingVersion: 1,
        invoiceCapacity: 500,
        itemCapacity: 10_000,
        paymentCapacity: 2_000,
        referenceSnapshot: snapshot,
        snapshotSha256: manifest.snapshotSha256,
        snapshotSignature,
        manifestSignature,
        issuedAt: new Date(manifest.issuedAt),
        closedByUserId: actorId,
        closedAt: new Date("2026-08-11T00:00:00.000Z"),
      });
      await db
        .insert(offlineSalesInvoiceSlots)
        .values(slots.map((slot) => ({ ...slot, workbookId })));

      const invoiceNumber = `OFF-F01-20260810-${reservedSerial}`;
      const official = await buildOfflineSalesWorkbook({
        manifest,
        manifestSignature,
        snapshot,
        snapshotSignature,
        operatorName: "Offline Integration Operator",
        slots,
      });
      const completed = await rewrite(official, (parts) => {
        let invoiceSheet = parts.get("xl/worksheets/sheet1.xml") ?? "";
        invoiceSheet = replaceCell(
          invoiceSheet,
          "E2",
          textCell("E2", 2, "2026-08-10"),
        );
        invoiceSheet = replaceCell(
          invoiceSheet,
          "F2",
          textCell("F2", 3, "12:30"),
        );
        invoiceSheet = replaceCell(
          invoiceSheet,
          "G2",
          textCell("G2", 1, "direct_distributor"),
        );
        invoiceSheet = replaceCell(
          invoiceSheet,
          "H2",
          textCell("H2", 1, `D-${customer.sNo}`),
        );
        invoiceSheet = replaceCell(
          invoiceSheet,
          "K2",
          textCell("K2", 2, "2026-08-20"),
        );
        parts.set("xl/worksheets/sheet1.xml", invoiceSheet);

        let itemSheet = parts.get("xl/worksheets/sheet2.xml") ?? "";
        itemSheet = replaceCell(
          itemSheet,
          "A2",
          textCell("A2", 1, invoiceNumber),
        );
        itemSheet = replaceCell(itemSheet, "B2", textCell("B2", 1, recipeId));
        itemSheet = replaceCell(itemSheet, "C2", numberCell("C2", 7, 2));
        itemSheet = replaceCell(itemSheet, "D2", numberCell("D2", 7, 0));
        itemSheet = replaceCell(itemSheet, "E2", textCell("E2", 1, "YES"));
        parts.set("xl/worksheets/sheet2.xml", itemSheet);

        let paymentSheet = parts.get("xl/worksheets/sheet3.xml") ?? "";
        paymentSheet = replaceCell(
          paymentSheet,
          "A2",
          textCell("A2", 1, invoiceNumber),
        );
        paymentSheet = replaceCell(
          paymentSheet,
          "B2",
          textCell("B2", 1, "cash"),
        );
        paymentSheet = replaceCell(
          paymentSheet,
          "C2",
          numberCell("C2", 7, 100),
        );
        paymentSheet = replaceCell(
          paymentSheet,
          "D2",
          textCell("D2", 1, cashWalletId),
        );
        paymentSheet = replaceCell(
          paymentSheet,
          "I2",
          textCell("I2", 2, "2026-08-10"),
        );
        paymentSheet = replaceCell(
          paymentSheet,
          "A3",
          textCell("A3", 1, invoiceNumber),
        );
        paymentSheet = replaceCell(
          paymentSheet,
          "B3",
          textCell("B3", 1, "bank_transfer"),
        );
        paymentSheet = replaceCell(
          paymentSheet,
          "C3",
          numberCell("C3", 7, 200),
        );
        paymentSheet = replaceCell(
          paymentSheet,
          "D3",
          textCell("D3", 1, bankWalletId),
        );
        paymentSheet = replaceCell(
          paymentSheet,
          "E3",
          textCell("E3", 1, "BANK-IT-1"),
        );
        paymentSheet = replaceCell(
          paymentSheet,
          "I3",
          textCell("I3", 2, "2026-08-10"),
        );
        parts.set("xl/worksheets/sheet3.xml", paymentSheet);
      });

      const parsed = await parseOfflineSalesWorkbook(completed);
      expect(parsed.invoices).toHaveLength(1);
      expect(parsed.invoices[0]).toMatchObject({
        invoiceNumber,
        invoiceAmount: 2200,
        paidAmount: 100,
        pendingAmount: 200,
        outstandingAmount: 2100,
      });
      const staged = await stageOfflineSalesUpload({
        parsed,
        metadata: {
          filename: `${workbookId}.xlsx`,
          byteSize: completed.byteLength,
          outageStartedAt: new Date("2026-08-09T19:00:00.000Z"),
          outageEndedAt: new Date("2026-08-10T18:59:59.000Z"),
          outageReason: "Integration test internet outage",
          uploadedByUserId: actorId,
        },
      });
      expect(staged.counts.warning).toBe(1);

      const [stagedInvoice] = await db
        .select()
        .from(offlineSalesStagedInvoices)
        .where(eq(offlineSalesStagedInvoices.batchId, staged.batchId));
      if (!stagedInvoice) throw new Error("Integration invoice was not staged");
      expect(stagedInvoice.issueCodes).toContain("stock_shortage");
      await db
        .update(offlineSalesStagedInvoices)
        .set({ warningsAcknowledged: true, reviewedByUserId: actorId })
        .where(eq(offlineSalesStagedInvoices.id, stagedInvoice.id));

      const result = await postOfflineSalesBatch({
        batchId: staged.batchId,
        actorId,
      });
      expect(result).toMatchObject({
        status: "completed",
        posted: 1,
        failed: 0,
        remaining: 0,
      });

      const [postedInvoice] = await db
        .select()
        .from(invoices)
        .where(eq(invoices.invoiceNumber, invoiceNumber));
      if (!postedInvoice) throw new Error("Integration invoice was not posted");
      expect(postedInvoice).toMatchObject({
        source: "offline_import",
        totalPrice: "2200.00",
        paidAmount: "100.00",
        outstandingAmount: "2100.00",
        offlineSalesSlotId: slots[0].id,
      });
      const paymentRows = await db
        .select()
        .from(payments)
        .where(eq(payments.invoiceId, postedInvoice.id));
      expect(paymentRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            method: "cash",
            status: "confirmed",
            amount: "100.00",
          }),
          expect.objectContaining({
            method: "bank_transfer",
            status: "pending",
            amount: "200.00",
          }),
        ]),
      );
      const [issue] = await db
        .select()
        .from(stockReconciliationIssues)
        .where(eq(stockReconciliationIssues.invoiceId, postedInvoice.id));
      expect(issue).toMatchObject({
        status: "open",
        requestedUnits: 24,
        availableUnits: 12,
        deficitUnits: 12,
      });
      const [stock] = await db
        .select()
        .from(finishedGoodsStock)
        .where(eq(finishedGoodsStock.recipeId, recipeId));
      expect(stock).toMatchObject({
        quantityCartons: 0,
        quantityContainers: 0,
      });
      const [batch] = await db
        .select()
        .from(offlineSalesImportBatches)
        .where(eq(offlineSalesImportBatches.id, staged.batchId));
      expect(batch).toMatchObject({ status: "completed", postedInvoices: 1 });
      const [slot] = await db
        .select()
        .from(offlineSalesInvoiceSlots)
        .where(eq(offlineSalesInvoiceSlots.id, slots[0].id));
      expect(slot).toMatchObject({
        status: "posted",
        postedInvoiceId: postedInvoice.id,
      });

      await expect(
        postOfflineSalesBatch({ batchId: staged.batchId, actorId }),
      ).resolves.toMatchObject({
        status: "completed",
        posted: 0,
        failed: 0,
      });
    }, 120_000);
  },
);
