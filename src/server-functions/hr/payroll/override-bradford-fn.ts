import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import {
  bradfordSnapshots,
  payslips,
  bradfordAuditLog,
} from "@/db/schemas/hr-schema";
import {
  requireHrManageMiddleware,
  requireHrViewMiddleware,
} from "@/lib/middlewares";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";

/**
 * Override Bradford Factor with mandatory audit logging.
 *
 * RBAC: Only HR managers or stronger roles can call this.
 * Every override creates an immutable audit log entry with:
 *  - computed score (what the system calculated)
 *  - override score (what the admin changed it to)
 *  - mandatory reason/justification
 *  - who performed it and when
 */
export const overrideBradfordFactorFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(
    z.object({
      payslipId: z.string(),
      overrideScore: z.string().nullable(), // null means remove override and use computed
      reason: z.string().min(5, "Provide a justification (min 5 chars)"),
    })
  )
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      // 1. Get current payslip to capture the computed score
      const payslip = await tx.query.payslips.findFirst({
        where: eq(payslips.id, data.payslipId),
      });

      if (!payslip) throw new Error("Payslip not found");
      const computedScore = payslip.bradfordFactorScore || "0";
      const effectiveScore = data.overrideScore || computedScore;

      // 2. Write the immutable audit log entry
      await tx.insert(bradfordAuditLog).values({
        payslipId: data.payslipId,
        employeeId: payslip.employeeId,
        computedScore,
        overrideScore: effectiveScore, // if removing override, log the computed
        reason: data.reason,
        performedBy: context.session.user.id,
      });

      // 3. Update the payslip
      const [updated] = await tx
        .update(payslips)
        .set({ bradfordFactorOverride: data.overrideScore })
        .where(eq(payslips.id, data.payslipId))
        .returning();

      await tx
        .update(bradfordSnapshots)
        .set({
          bradfordFactor: effectiveScore,
          updatedAt: new Date(),
        })
        .where(eq(bradfordSnapshots.payslipId, data.payslipId));

      return updated;
    });
  });

/**
 * Get Bradford Factor audit history for a payslip.
 */
export const getBradfordAuditLogFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(z.object({ payslipId: z.string() }))
  .handler(async ({ data }) => {
    return await db.query.bradfordAuditLog.findMany({
      where: eq(bradfordAuditLog.payslipId, data.payslipId),
      with: {
        performer: {
          columns: { id: true, name: true, email: true },
        },
      },
      orderBy: [desc(bradfordAuditLog.performedAt)],
    });
  });
