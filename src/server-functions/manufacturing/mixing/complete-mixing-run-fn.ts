import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireProductionWorkCompleteMiddleware } from "@/lib/middlewares";
import { hasPermission } from "@/lib/rbac";
import { mixingRuns } from "@/db/schemas/production-schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { completeMixingRunCore } from "./complete-mixing-run-core.server";

const completeMixingRunSchema = z.object({
  mixingRunId: z.string().min(1, "Mixing batch ID is required"),
  shortfallReason: z.string().optional(),
});

export const completeMixingRunFn = createServerFn()
  .middleware([requireProductionWorkCompleteMiddleware])
  .inputValidator(completeMixingRunSchema)
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      const [run] = await tx.select({ operatorId: mixingRuns.operatorId })
        .from(mixingRuns).where(eq(mixingRuns.id, data.mixingRunId)).for("update");
      if (!run) throw new Error("Mixing batch not found");
      if (run.operatorId !== context.session.user.id &&
          !hasPermission(context.authContext.permissions, "manufacturing.run.manage")) {
        throw new Error("This mixing batch is assigned to another operator");
      }
      await completeMixingRunCore(
        tx,
        data.mixingRunId,
        context.session.user.id,
        context.session.user.name,
        data.shortfallReason,
      );
      return { success: true };
    });
  });
