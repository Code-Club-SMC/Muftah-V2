import { createServerFn } from "@tanstack/react-start";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  db,
  invoices,
  recipes,
  stockReconciliationIssues,
  warehouses,
} from "@/db";
import { requireOfflineSalesEnabled } from "@/lib/sales/offline/feature-flag.server";
import { requireStockReconciliationManageMiddleware } from "@/lib/middlewares";

const listSchema = z.object({
  status: z.enum(["open", "resolved", "all"]).default("open"),
});

const resolveSchema = z.object({
  issueId: z.string().min(1),
  resolutionType: z.enum(["counted_adjustment", "missing_record"]),
  resolutionReference: z.string().trim().min(1).max(120),
  resolutionReason: z.string().trim().min(5).max(500),
});

export const listStockReconciliationIssuesFn = createServerFn()
  .middleware([requireStockReconciliationManageMiddleware])
  .inputValidator(listSchema)
  .handler(async ({ data }) => {
    requireOfflineSalesEnabled();

    const rows = await db
      .select({
        id: stockReconciliationIssues.id,
        status: stockReconciliationIssues.status,
        invoiceId: stockReconciliationIssues.invoiceId,
        invoiceNumber: invoices.invoiceNumber,
        invoiceDate: invoices.date,
        recipeId: stockReconciliationIssues.recipeId,
        productName: recipes.name,
        warehouseId: stockReconciliationIssues.warehouseId,
        warehouseName: warehouses.name,
        requestedUnits: stockReconciliationIssues.requestedUnits,
        availableUnits: stockReconciliationIssues.availableUnits,
        deficitUnits: stockReconciliationIssues.deficitUnits,
        snapshotStockUnits: stockReconciliationIssues.snapshotStockUnits,
        liveStockUnits: stockReconciliationIssues.liveStockUnits,
        resolutionReference: stockReconciliationIssues.resolutionReference,
        resolutionType: stockReconciliationIssues.resolutionType,
        resolutionReason: stockReconciliationIssues.resolutionReason,
        resolvedByUserId: stockReconciliationIssues.resolvedByUserId,
        resolvedAt: stockReconciliationIssues.resolvedAt,
        createdAt: stockReconciliationIssues.createdAt,
      })
      .from(stockReconciliationIssues)
      .innerJoin(invoices, eq(invoices.id, stockReconciliationIssues.invoiceId))
      .innerJoin(recipes, eq(recipes.id, stockReconciliationIssues.recipeId))
      .innerJoin(
        warehouses,
        eq(warehouses.id, stockReconciliationIssues.warehouseId),
      )
      .where(
        data.status === "all"
          ? undefined
          : eq(stockReconciliationIssues.status, data.status),
      )
      .orderBy(desc(stockReconciliationIssues.createdAt));

    return { issues: rows };
  });

export const resolveStockReconciliationIssueFn = createServerFn({
  method: "POST",
})
  .middleware([requireStockReconciliationManageMiddleware])
  .inputValidator(resolveSchema)
  .handler(async ({ data, context }) => {
    requireOfflineSalesEnabled();

    return await db.transaction(async (tx) => {
      const [issue] = await tx
        .select({
          id: stockReconciliationIssues.id,
          status: stockReconciliationIssues.status,
        })
        .from(stockReconciliationIssues)
        .where(eq(stockReconciliationIssues.id, data.issueId))
        .for("update")
        .limit(1);

      if (!issue) throw new Error("Stock reconciliation issue was not found.");
      if (issue.status !== "open") {
        throw new Error("This stock reconciliation issue is already resolved.");
      }

      const now = new Date();
      const [resolved] = await tx
        .update(stockReconciliationIssues)
        .set({
          status: "resolved",
          resolutionType: data.resolutionType,
          resolutionReference: data.resolutionReference,
          resolutionReason: data.resolutionReason,
          resolvedByUserId: context.session.user.id,
          resolvedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(stockReconciliationIssues.id, data.issueId),
            eq(stockReconciliationIssues.status, "open"),
          ),
        )
        .returning();

      if (!resolved) {
        throw new Error("This stock reconciliation issue is already resolved.");
      }
      return resolved;
    });
  });
