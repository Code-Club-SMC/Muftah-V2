import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/db/schemas/offline-sales-schema.ts"),
  "utf8",
);
const invoiceSource = readFileSync(
  resolve(process.cwd(), "src/db/schemas/sales-schema.ts"),
  "utf8",
);
const migrationSource = readFileSync(
  resolve(process.cwd(), "src/db/migrations/0011_smiling_puma.sql"),
  "utf8",
);

describe("offline sales schema", () => {
  it("enforces one active factory workbook and immutable slot identities", () => {
    expect(source).toContain("offline_sales_workbooks_one_active_factory_idx");
    expect(source).toContain("sql`${table.status} = 'active'`");
    expect(source).toContain("offline_sales_slots_token_idx");
    expect(source).toContain("offline_sales_slots_serial_idx");
    expect(source).toContain("offline_sales_slots_workbook_slot_idx");
  });

  it("keeps parsed business rows instead of workbook documents", () => {
    expect(source).toContain("offline_sales_staged_invoices");
    expect(source).toContain("offline_sales_staged_items");
    expect(source).toContain("offline_sales_staged_payments");
    expect(source).not.toMatch(/workbookBytes|fileBytes|documentBlob|ooxmlFragment/);
  });

  it("links a posted invoice exactly once and requires positive deficits", () => {
    expect(invoiceSource).toContain("offlineSalesSlotId");
    expect(invoiceSource).toContain("invoices_offline_sales_slot_unique");
    expect(migrationSource).toContain(
      "invoices_offline_sales_slot_id_offline_sales_invoice_slots_id_fk",
    );
    expect(source).toContain("offline_sales_slots_posted_invoice_idx");
    expect(source).toContain("stock_reconciliation_issues_deficit_check");
    expect(source).toContain("${table.deficitUnits} > 0");
  });
});
