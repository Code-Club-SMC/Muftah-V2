import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { formulas, mixingRuns } from "@/db/schemas/production-schema";
import { requireManufacturingManageMiddleware } from "@/lib/middlewares";
import { and, eq, inArray } from "drizzle-orm";

export const deleteFormulaFn = createServerFn()
  .middleware([requireManufacturingManageMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    return await db.transaction(async (tx) => {
      const [existing] = await tx.select().from(formulas).where(eq(formulas.id, data.id)).for("update");
      if (!existing) throw new Error("Mixing Formula not found");
      const activeRun = await tx.query.mixingRuns.findFirst({
        where: and(eq(mixingRuns.formulaId, data.id), inArray(mixingRuns.status, ["scheduled", "in_progress"])),
      });
      if (activeRun) throw new Error("Finish or cancel active mixing work before deactivating its mixing formula");
      const [formula] = await tx
        .update(formulas)
        .set({ isActive: false })
        .where(eq(formulas.id, data.id))
        .returning();

      if (!formula) {
        throw new Error("Mixing Formula not found");
      }

      return { success: true, formula };
    });
  });
