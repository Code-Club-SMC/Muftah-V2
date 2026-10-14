import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import {
  products,
  productionRunLabReports,
} from "@/db/schemas/inventory-schema";
import { formulas, mixingRuns } from "@/db/schemas/production-schema";
import {
  requireMixingLabReportReadMiddleware,
  requireProductionQCManageMiddleware,
  requireProductionQCReadMiddleware,
} from "@/lib/middlewares";
import { hasPermission, type PermissionKey } from "@/lib/rbac";
import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";

const batchIdentity = z.object({
  mixingRunId: z.string().trim().min(1).max(200),
});
const reportIdentity = batchIdentity.extend({
  reportId: z.string().trim().min(1).max(200),
});
const optionalText = z.string().trim().max(500).optional();
const reportFields = z.object({
  stockNumber: optionalText,
  lotNumber: optionalText,
  analysisItems: z
    .array(
      z.object({
        item: z.string().trim().min(1).max(200),
        requirement: z.string().trim().min(1).max(1000),
        result: z.string().trim().min(1).max(1000),
        passed: z.boolean(),
      }),
    )
    .min(1)
    .max(100),
  certifiedBy: z.string().trim().min(1).max(200),
  certifierTitle: optionalText,
  reportDate: z.union([z.iso.date(), z.iso.datetime({ offset: true })]),
  standardReference: optionalText,
  notes: z.string().trim().max(10000).optional(),
});

export const getProductionQCBatchesFn = createServerFn({ method: "GET" })
  .middleware([requireProductionQCReadMiddleware])
  .inputValidator(
    z.object({
      search: z.string().trim().max(200).default(""),
      page: z.number().int().positive().default(1),
      limit: z.number().int().min(1).max(100).default(20),
    }),
  )
  .handler(async ({ data }) => {
    const search = `%${data.search}%`;
    const rows = await db
      .select({
        id: mixingRuns.id,
        batchId: mixingRuns.batchId,
        status: mixingRuns.status,
        formulaName: formulas.name,
        productName: products.name,
        actualBulkProduced: mixingRuns.actualBulkProduced,
        targetBulkQuantity: mixingRuns.targetBulkQuantity,
        bulkUnit: mixingRuns.bulkUnit,
      })
      .from(mixingRuns)
      .innerJoin(formulas, eq(mixingRuns.formulaId, formulas.id))
      .innerJoin(products, eq(formulas.productId, products.id))
      .where(
        data.search
          ? or(
              ilike(mixingRuns.batchId, search),
              ilike(formulas.name, search),
              ilike(products.name, search),
            )
          : undefined,
      )
      .orderBy(desc(mixingRuns.createdAt), desc(mixingRuns.id))
      .limit(data.limit + 1)
      .offset((data.page - 1) * data.limit);
    return {
      batches: rows.slice(0, data.limit),
      hasMore: rows.length > data.limit,
      page: data.page,
    };
  });

export const getMixingLabReportsFn = createServerFn({ method: "GET" })
  .middleware([requireMixingLabReportReadMiddleware])
  .inputValidator(batchIdentity)
  .handler(async ({ data, context }) => {
    const run = await db.query.mixingRuns.findFirst({
      where: eq(mixingRuns.id, data.mixingRunId),
      columns: { operatorId: true },
    });
    if (!run) throw new Error("Mixing batch not found");
    const broadReadPermissions: PermissionKey[] = [
      "manufacturing.qc.read",
      "manufacturing.qc.manage",
      "manufacturing.manage",
      "manufacturing.run.manage",
      "manufacturing.run.read",
      "manufacturing.view",
    ];
    if (
      run.operatorId !== context.session.user.id &&
      !broadReadPermissions.some((permission) =>
        hasPermission(context.authContext.permissions, permission),
      )
    ) {
      throw new Error("This mixing batch is assigned to another operator");
    }
    return db.query.productionRunLabReports.findMany({
      where: eq(productionRunLabReports.mixingRunId, data.mixingRunId),
      with: { createdBy: { columns: { id: true, name: true } } },
      orderBy: [
        desc(productionRunLabReports.reportDate),
        desc(productionRunLabReports.id),
      ],
    });
  });

function reportValues(data: z.infer<typeof reportFields>) {
  return {
    stockNumber: data.stockNumber || null,
    lotNumber: data.lotNumber || null,
    analysisItems: data.analysisItems,
    certifiedBy: data.certifiedBy,
    certifierTitle: data.certifierTitle || null,
    reportDate: new Date(data.reportDate),
    standardReference: data.standardReference || null,
    notes: data.notes || null,
  };
}

export const createMixingLabReportFn = createServerFn({ method: "POST" })
  .middleware([requireProductionQCManageMiddleware])
  .inputValidator(batchIdentity.merge(reportFields))
  .handler(async ({ data, context }) => {
    const run = await db.query.mixingRuns.findFirst({
      where: eq(mixingRuns.id, data.mixingRunId),
      with: { formula: { with: { product: true } } },
    });
    if (!run) throw new Error("Mixing batch not found");
    const [report] = await db
      .insert(productionRunLabReports)
      .values({
        ...reportValues(data),
        mixingRunId: run.id,
        productionRunId: null,
        productName: run.formula.product.name,
        lotNumber: data.lotNumber || run.batchId,
        createdById: context.session.user.id,
      })
      .returning();
    return report;
  });

export const updateMixingLabReportFn = createServerFn({ method: "POST" })
  .middleware([requireProductionQCManageMiddleware])
  .inputValidator(reportIdentity.merge(reportFields))
  .handler(async ({ data }) => {
    const [report] = await db
      .update(productionRunLabReports)
      .set({
        ...reportValues(data),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(productionRunLabReports.id, data.reportId),
          eq(productionRunLabReports.mixingRunId, data.mixingRunId),
        ),
      )
      .returning();
    if (!report)
      throw new Error("Quality report not found for this mixing batch");
    return report;
  });

export const deleteMixingLabReportFn = createServerFn({ method: "POST" })
  .middleware([requireProductionQCManageMiddleware])
  .inputValidator(reportIdentity)
  .handler(async ({ data }) => {
    const [report] = await db
      .delete(productionRunLabReports)
      .where(
        and(
          eq(productionRunLabReports.id, data.reportId),
          eq(productionRunLabReports.mixingRunId, data.mixingRunId),
        ),
      )
      .returning({ id: productionRunLabReports.id });
    if (!report)
      throw new Error("Quality report not found for this mixing batch");
    return { success: true, id: report.id };
  });

export type MixingLabReport = Awaited<
  ReturnType<typeof getMixingLabReportsFn>
>[number];
