import { createServerFn } from "@tanstack/react-start";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  HR_PAYROLL_SETTINGS_SINGLETON_ID,
  hrPayrollSettings,
} from "@/db/schemas/hr-schema";
import {
  requireHrManageMiddleware,
  requireHrViewMiddleware,
} from "@/lib/middlewares";
import {
  basicSalaryDeductionPolicySchema,
} from "@/lib/validators/hr-validators";
import { DEFAULT_BASIC_SALARY_DEDUCTION_POLICY } from "@/lib/types/hr-types";
import { z } from "zod";

async function ensureHrPayrollSettings() {
  const existing = await db.query.hrPayrollSettings.findFirst({
    where: eq(hrPayrollSettings.id, HR_PAYROLL_SETTINGS_SINGLETON_ID),
  });

  if (existing) return existing;

  const [created] = await db
    .insert(hrPayrollSettings)
    .values({
      id: HR_PAYROLL_SETTINGS_SINGLETON_ID,
      basicSalaryDeductionPolicy: DEFAULT_BASIC_SALARY_DEDUCTION_POLICY,
    })
    .onConflictDoNothing()
    .returning();

  if (created) return created;

  const reloaded = await db.query.hrPayrollSettings.findFirst({
    where: eq(hrPayrollSettings.id, HR_PAYROLL_SETTINGS_SINGLETON_ID),
  });
  if (!reloaded) throw new Error("Unable to initialize HR payroll settings");
  return reloaded;
}

export const getHrPayrollSettingsFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .handler(async () => {
    return await ensureHrPayrollSettings();
  });

export const updateHrPayrollSettingsFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(
    z.object({
      basicSalaryDeductionPolicy: basicSalaryDeductionPolicySchema,
    }),
  )
  .handler(async ({ data, context }) => {
    await ensureHrPayrollSettings();

    const [updated] = await db
      .update(hrPayrollSettings)
      .set({
        basicSalaryDeductionPolicy: data.basicSalaryDeductionPolicy,
        updatedBy: context.session.user.id,
      })
      .where(eq(hrPayrollSettings.id, HR_PAYROLL_SETTINGS_SINGLETON_ID))
      .returning();

    return updated;
  });
