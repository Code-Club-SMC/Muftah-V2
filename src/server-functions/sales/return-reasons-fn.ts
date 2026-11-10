import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { salesReturnReasons } from "@/db/schemas/sales-erp-schema";
import { requireSalesConfigManageMiddleware, requireSalesViewMiddleware } from "@/lib/middlewares";
import { ensureReturnReasonsSeeded } from "@/lib/sales/returns/return-reasons.server";

export const getReturnReasonsFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator((input: any) => z.object({ includeInactive: z.boolean().optional() }).parse(input ?? {}))
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    await ensureReturnReasonsSeeded(db);
    return db
      .select({
        id: salesReturnReasons.id,
        name: salesReturnReasons.name,
        requiresNote: salesReturnReasons.requiresNote,
        isActive: salesReturnReasons.isActive,
        sortOrder: salesReturnReasons.sortOrder,
      })
      .from(salesReturnReasons)
      .where(data.includeInactive ? undefined : eq(salesReturnReasons.isActive, true))
      .orderBy(asc(salesReturnReasons.sortOrder), asc(salesReturnReasons.name));
  });

export const saveReturnReasonFn = createServerFn()
  .middleware([requireSalesConfigManageMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        id: z.string().min(1).optional(),
        name: z.string().trim().min(2, "Name the reason (at least 2 characters).").max(80),
        requiresNote: z.boolean(),
        isActive: z.boolean(),
        sortOrder: z.number().int().min(0).max(999).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { db } = await import("@/db");
    const name = data.name.trim();
    const duplicate = await db.query.salesReturnReasons.findFirst({
      where: and(
        sql`lower(${salesReturnReasons.name}) = lower(${name})`,
        data.id ? ne(salesReturnReasons.id, data.id) : undefined,
      ),
    });
    if (duplicate) throw new Error(`A reason called "${name}" already exists.`);

    if (data.id) {
      const [updated] = await db
        .update(salesReturnReasons)
        .set({
          name,
          requiresNote: data.requiresNote,
          isActive: data.isActive,
          ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
          updatedAt: new Date(),
        })
        .where(eq(salesReturnReasons.id, data.id))
        .returning();
      if (!updated) throw new Error("Reason not found");
      return updated;
    }

    const [{ next }] = await db
      .select({ next: sql<number>`coalesce(max(${salesReturnReasons.sortOrder}), -1) + 1` })
      .from(salesReturnReasons);
    const [created] = await db
      .insert(salesReturnReasons)
      .values({
        name,
        requiresNote: data.requiresNote,
        isActive: data.isActive,
        sortOrder: data.sortOrder ?? Number(next),
      })
      .returning();
    return created;
  });
