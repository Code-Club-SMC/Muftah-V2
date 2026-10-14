import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { mixingRuns } from "@/db/schemas/production-schema";
import { requireProductionWorkFailMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { eq } from "drizzle-orm";

export const failMixingRunFn = createServerFn()
  .middleware([requireProductionWorkFailMiddleware])
  .inputValidator(z.object({ id: z.string().min(1), reason: z.string().trim().min(1) }))
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      const [run] = await tx
        .select()
        .from(mixingRuns)
        .where(eq(mixingRuns.id, data.id))
        .for("update");

      if (!run) throw new Error("Mixing batch not found");
      if (run.operatorId !== context.session.user.id &&
          !hasPermission(context.authContext.permissions, "manufacturing.run.manage")) {
        throw new Error("This mixing batch is assigned to another operator");
      }
      if (run.status !== "in_progress") {
        throw new Error(`Cannot fail a mixing batch with status: ${run.status}`);
      }
      const logs = await tx.query.mixingProgressLogs.findFirst({
        where: (log, { eq }) => eq(log.mixingRunId, run.id),
      });
      if (Number(run.actualBulkProduced ?? 0) > 0 || logs) {
        throw new Error("This mixing batch already has output. Complete it with a shortfall reason instead");
      }

      const [updated] = await tx
        .update(mixingRuns)
        .set({
          status: "failed",
          shortfallReason: data.reason,
          closedBy: context.session.user.id,
          actualCompletionDate: new Date(),
        })
        .where(eq(mixingRuns.id, data.id))
        .returning();

      return updated;
    });
  });
