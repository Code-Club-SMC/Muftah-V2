import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { customers, invoices, invoiceItems } from "@/db/schemas/sales-schema";
import { payments, slipRecords } from "@/db/schemas/sales-erp-schema";
import { requireSalesManageMiddleware } from "@/lib/middlewares";
import { eq, inArray } from "drizzle-orm";

// ═══════════════════════════════════════════════════════════════════════════
// CLEAR DISTRIBUTOR LEDGER SEED DATA
// Removes all invoices, items, payments, and slip records for the seeded
// distributor "Al-Madina Distributors" and resets their totals.
// ═══════════════════════════════════════════════════════════════════════════
export const clearDistributorLedgerSeedFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .handler(async () => {
    // Find the seeded distributor
    const distributor = await db.query.customers.findFirst({
      where: eq(customers.name, "Al-Madina Distributors"),
      columns: { id: true },
    });

    if (!distributor) {
      return { success: false, message: "Seeded distributor not found. Nothing to clear." };
    }

    // Fetch all invoice IDs for this distributor
    const invoiceRows = await db
      .select({ id: invoices.id })
      .from(invoices)
      .where(eq(invoices.customerId, distributor.id));

    const invoiceIds = invoiceRows.map((r) => r.id);

    if (invoiceIds.length === 0) {
      return { success: false, message: "No seeded invoices found for this distributor." };
    }

    // Delete related records in dependency order
    await db.delete(invoiceItems).where(inArray(invoiceItems.invoiceId, invoiceIds));
    await db.delete(payments).where(inArray(payments.invoiceId, invoiceIds));
    await db.delete(slipRecords).where(inArray(slipRecords.invoiceId, invoiceIds));
    await db.delete(invoices).where(inArray(invoices.id, invoiceIds));

    // Reset distributor totals
    await db
      .update(customers)
      .set({
        totalSale: "0",
        payment: "0",
        credit: "0",
      })
      .where(eq(customers.id, distributor.id));

    return {
      success: true,
      message: `Cleared ${invoiceIds.length} invoices and related records for Al-Madina Distributors.`,
    };
  });
