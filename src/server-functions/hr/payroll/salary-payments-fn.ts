import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { db } from "@/db";
import { requireHrManageMiddleware, requireHrViewMiddleware } from "@/lib/middlewares";
import { requirePermission } from "@/lib/authz.server";
import { reportDateKey } from "@/lib/report-dates";
import { paySalaries } from "./salary-payments.server";

const dateKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a payment date");

export const paySalariesFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({
    payrollId: z.string().min(1),
    employeeIds: z.array(z.string().min(1)).min(1, "Choose at least one salary"),
    walletId: z.string().min(1, "Choose an account"),
    paymentDate: dateKey,
  }))
  .handler(async ({ data, context }) => {
    requirePermission(context.authContext, "finance.manage");
    return db.transaction((tx) =>
      paySalaries(tx, { ...data, todayKey: reportDateKey(new Date()), actorId: context.session.user.id }),
    );
  });
