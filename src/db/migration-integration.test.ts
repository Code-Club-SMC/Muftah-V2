import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

type Journal = {
  version: string;
  dialect: string;
  entries: {
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }[];
};
type Snapshot = {
  id: string;
  prevId: string;
  tables: Record<string, { columns: Record<string, Record<string, unknown>> }>;
};

const directory = resolve(process.cwd(), "src/db/migrations");
const baseline = JSON.parse(
  readFileSync(resolve(directory, "../migration-baseline.json"), "utf8"),
) as Journal & { sha256: Record<string, string> };
const journal = JSON.parse(
  readFileSync(resolve(directory, "meta/_journal.json"), "utf8"),
) as Journal;
const snapshotName = (idx: number) =>
  `${String(idx).padStart(4, "0")}_snapshot.json`;
const readSnapshot = (idx: number): Snapshot =>
  JSON.parse(
    readFileSync(resolve(directory, "meta", snapshotName(idx)), "utf8"),
  );
const forwardEntries = journal.entries.slice(baseline.entries.length);
const forwardSql = forwardEntries
  .map(({ tag }) => readFileSync(resolve(directory, `${tag}.sql`), "utf8"))
  .join("\n");

function expectColumns(table: string, columns: Record<string, string>) {
  for (const [column, definition] of Object.entries(columns)) {
    expect(forwardSql).toContain(
      `ALTER TABLE "${table}" ADD COLUMN "${column}" ${definition};`,
    );
  }
}

describe("production migration integration", () => {
  it("preserves every baseline SQL file and snapshot byte-for-byte", () => {
    for (const [file, hash] of Object.entries(baseline.sha256)) {
      // The generator appends to the journal; its original entries are checked below.
      if (file === "meta/_journal.json") continue;
      expect(
        createHash("sha256")
          .update(readFileSync(resolve(directory, file)))
          .digest("hex"),
        file,
      ).toBe(hash);
    }
    for (const { idx, tag } of baseline.entries) {
      expect(Object.keys(baseline.sha256)).toContain(`${tag}.sql`);
      expect(Object.keys(baseline.sha256)).toContain(
        `meta/${snapshotName(idx)}`,
      );
    }
  });

  it("preserves exact baseline journal entries and appends contiguous, strictly newer entries", () => {
    expect(journal.version).toBe(baseline.version);
    expect(journal.dialect).toBe(baseline.dialect);
    expect(journal.entries.slice(0, baseline.entries.length)).toEqual(
      baseline.entries,
    );
    for (const [idx, entry] of journal.entries.entries()) {
      expect(entry.idx).toBe(idx);
      expect(entry.tag).toMatch(
        new RegExp(`^${String(idx).padStart(4, "0")}_`),
      );
      expect(entry.version).toBe(baseline.version);
      if (idx > 0)
        expect(entry.when).toBeGreaterThan(journal.entries[idx - 1].when);
    }
    expect(
      forwardEntries.length,
      "generate a new forward migration after 0025",
    ).toBeGreaterThan(0);
  });

  it("has one SQL file and distinct snapshot per entry, with ID-linked snapshot ancestry", () => {
    expect(
      readdirSync(directory)
        .filter((file) => file.endsWith(".sql"))
        .sort(),
    ).toEqual(journal.entries.map(({ tag }) => `${tag}.sql`).sort());
    expect(
      readdirSync(resolve(directory, "meta"))
        .filter((file) => file.endsWith("_snapshot.json"))
        .sort(),
    ).toEqual(journal.entries.map(({ idx }) => snapshotName(idx)).sort());
    // This baseline includes a distinct 0001 snapshot despite the custom seed SQL tag.
    let predecessor = "00000000-0000-0000-0000-000000000000";
    const ids = new Set<string>();
    for (const { idx } of journal.entries) {
      const snapshot = readSnapshot(idx);
      expect(snapshot.prevId, snapshotName(idx)).toBe(predecessor);
      expect(snapshot.id).toMatch(
        /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i,
      );
      expect(ids.has(snapshot.id)).toBe(false);
      ids.add(snapshot.id);
      predecessor = snapshot.id;
    }
  });

  it("adds all offline sales business fields and validation constraints", () => {
    expectColumns("offline_sales_staged_invoices", {
      customer_details: "jsonb",
      invoice_discount: "numeric(12, 2) DEFAULT '0' NOT NULL",
      invoice_discount_description: "text",
      expenses: "numeric(12, 2) DEFAULT '0' NOT NULL",
      expenses_description: "text",
      printed_total: "numeric(12, 2)",
    });
    expectColumns("offline_sales_staged_items", {
      manual_free_cartons: "integer DEFAULT 0 NOT NULL",
      is_price_override: "boolean DEFAULT false NOT NULL",
      listed_carton_price: "numeric(12, 2)",
    });
    expectColumns("offline_sales_staged_payments", {
      expense_type: "text",
      expense_employee_id: "text",
      notes: "text",
      instant_verify: "boolean DEFAULT false NOT NULL",
    });
    for (const constraint of [
      "offline_sales_staged_extras_check",
      "offline_sales_staged_items_manual_free_check",
    ]) {
      expect(forwardSql).toContain(`ADD CONSTRAINT "${constraint}" CHECK`);
    }
  });

  it("adds returns lifecycle fields without rewriting historical returns", () => {
    expect(forwardSql).toContain('CREATE TABLE "sales_return_reasons"');
    expect(forwardSql).toContain(
      'CREATE UNIQUE INDEX "uq_sales_return_reasons_name"',
    );
    expectColumns("sales_returns", {
      reason_id: "text",
      reason_note: "text",
      created_by_id: "text",
      reject_reason: "text",
      received_by_id: "text",
      cancelled_by_id: "text",
      cancelled_at: "timestamp",
      cancel_reason: "text",
      voided_by_id: "text",
      voided_at: "timestamp",
      void_reason: "text",
    });
    expectColumns(
      "sales_return_items",
      Object.fromEntries(
        [
          "cartons_requested",
          "quantity_requested",
          "good_units",
          "damaged_units",
          "expired_units",
        ].map((column) => [column, "integer DEFAULT 0 NOT NULL"]),
      ),
    );
    expectColumns("sales_return_stock_traces", {
      kind: "text DEFAULT 'receive' NOT NULL",
    });
    expect(forwardSql).toContain(
      'ALTER TABLE "sales_returns" ALTER COLUMN "status" SET DEFAULT \'requested\';',
    );
    expect(forwardSql).toContain('CREATE INDEX "idx_sales_returns_reason"');
    expect(forwardSql).toContain(
      'FOREIGN KEY ("reason_id") REFERENCES "public"."sales_return_reasons"("id")',
    );
  });

  it("adds purchase audit, purchase-owned lab reports, and packaging kind", () => {
    expectColumns("purchase_records", {
      voided_at: "timestamp with time zone",
      voided_by_id: "text",
      void_reason: "text",
      void_refund_amount: "numeric(12, 2)",
      void_refund_wallet_id: "text",
      void_snapshot: "jsonb",
    });
    expectColumns("chemical_lab_reports", { purchase_id: "text" });
    expectColumns("packaging_materials", { packaging_kind: "text" });
    for (const constraint of [
      "purchase_void_refund_bounds",
      "purchase_void_metadata",
      "packaging_materials_kind_check",
    ]) {
      expect(forwardSql).toContain(`ADD CONSTRAINT "${constraint}" CHECK`);
    }
    expect(forwardSql).toContain('CREATE INDEX "purchase_active_supplier_idx"');
    expect(forwardSql).toContain('CREATE INDEX "lab_report_purchase_idx"');
    expect(forwardSql).toContain(
      'FOREIGN KEY ("purchase_id") REFERENCES "public"."purchase_records"("id") ON DELETE restrict',
    );
    expect(forwardSql).toContain(
      'FOREIGN KEY ("void_refund_wallet_id") REFERENCES "public"."wallets"("id")',
    );
  });

  it("generates the missing invoice offline-slot foreign key in forward SQL", () => {
    expect(forwardSql).toContain(
      'ALTER TABLE "invoices" ADD CONSTRAINT "invoices_offline_sales_slot_id_offline_sales_invoice_slots_id_fk" FOREIGN KEY ("offline_sales_slot_id") REFERENCES "public"."offline_sales_invoice_slots"("id") ON DELETE restrict ON UPDATE no action;',
    );
  });

  it("preserves all baseline tables and column definitions except the approved new-return status default", () => {
    const previous = readSnapshot(baseline.entries.at(-1)!.idx);
    const latest = readSnapshot(journal.entries.at(-1)!.idx);
    for (const [table, definition] of Object.entries(previous.tables)) {
      expect(Object.keys(latest.tables), table).toContain(table);
      for (const [column, original] of Object.entries(definition.columns)) {
        const expected =
          table === "public.sales_returns" && column === "status"
            ? { ...original, default: "'requested'" }
            : original;
        expect(
          latest.tables[table].columns[column],
          `${table}.${column}`,
        ).toEqual(expected);
      }
    }
  });

  it("allows only additive DDL and the status default change, never destructive DDL or data mutation", () => {
    const sql = forwardSql
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/--[^\n]*/g, "");
    expect(sql).not.toMatch(/\b(?:DROP|TRUNCATE)\b/i);
    expect(sql).not.toMatch(
      /\b(?:INSERT\s+INTO|DELETE\s+FROM|MERGE\s+INTO)\b/i,
    );
    expect(sql).not.toMatch(
      /\bUPDATE\s+(?:"[^"]+"(?:\."[^"]+")?|\w+(?:\.\w+)?)\s+SET\b/i,
    );
    const statements = sql
      .split(";")
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements.length).toBeGreaterThan(0);
    for (const statement of statements) {
      expect(statement).toMatch(
        /^(?:CREATE TABLE |CREATE (?:UNIQUE )?INDEX |ALTER TABLE "[^"]+" ADD (?:COLUMN|CONSTRAINT) |ALTER TABLE "sales_returns" ALTER COLUMN "status" SET DEFAULT 'requested'$)/,
      );
    }
  });
});
