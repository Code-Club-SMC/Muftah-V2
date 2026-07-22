import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import {
  employees,
  attendance,
  bradfordSnapshots,
  bradfordAuditLog,
  payslips,
  salaryAdvances,
  travelLogs,
} from "@/db/schemas/hr-schema";
import { and, count, eq, inArray, isNotNull, or } from "drizzle-orm";
import { deleteEmployeeSchema } from "@/lib/validators/hr-validators";
import { requireHrManageMiddleware } from "@/lib/middlewares";
import {
  reversePayslipSideEffects,
  syncPayrollTotal,
} from "@/server-functions/hr/payroll/core";

export const deleteEmployeeFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator((data: unknown) => deleteEmployeeSchema.parse(data))
  .handler(async ({ data }) => {
    await db
      .update(employees)
      .set({ status: "pending_deletion" })
      .where(eq(employees.id, data.id));
    return { success: true };
  });

/**
 * Approve and execute actual deletion of an employee and their records
 */
export const approveEmployeeDeletionFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator((data: unknown) => deleteEmployeeSchema.parse(data))
  .handler(async ({ data }) => {
    await db.transaction(async (tx) => {
      const employeePayslips = await tx.query.payslips.findMany({
        where: eq(payslips.employeeId, data.id),
        columns: {
          id: true,
          payrollId: true,
        },
        with: {
          payroll: {
            columns: {
              id: true,
              status: true,
            },
          },
        },
      });

      const lockedPayroll = employeePayslips.find(
        (payslip) => (payslip.payroll?.status ?? "draft") !== "draft",
      );
      if (lockedPayroll) {
        throw new Error(
          "Cannot delete an employee with approved or paid payroll history. Archive the employee instead.",
        );
      }

      for (const payslip of employeePayslips) {
        await reversePayslipSideEffects(tx, payslip.id);
      }

      if (employeePayslips.length > 0) {
        await tx.delete(payslips).where(eq(payslips.employeeId, data.id));

        const affectedPayrollIds = [...new Set(employeePayslips.map((payslip) => payslip.payrollId))];
        for (const payrollId of affectedPayrollIds) {
          await syncPayrollTotal(tx, payrollId);
        }
      }

      const financiallyLinkedAdvance = await tx.query.salaryAdvances.findFirst({
        where: and(
          eq(salaryAdvances.employeeId, data.id),
          or(
            inArray(salaryAdvances.status, ["approved", "settled"]),
            isNotNull(salaryAdvances.walletId),
            isNotNull(salaryAdvances.paidAt),
            isNotNull(salaryAdvances.deductedInPayslipId),
          ),
        ),
        columns: {
          id: true,
        },
      });
      if (financiallyLinkedAdvance) {
        throw new Error(
          "Cannot delete an employee with paid salary advances or recovered installments. Archive the employee instead.",
        );
      }

      const financiallyLinkedTravelLog = await tx.query.travelLogs.findFirst({
        where: and(
          eq(travelLogs.employeeId, data.id),
          or(
            eq(travelLogs.status, "reimbursed"),
            isNotNull(travelLogs.reimbursedAt),
            isNotNull(travelLogs.paidInPayslipId),
          ),
        ),
        columns: {
          id: true,
        },
      });
      if (financiallyLinkedTravelLog) {
        throw new Error(
          "Cannot delete an employee with reimbursed TA/DA history. Archive the employee instead.",
        );
      }

      await tx
        .delete(bradfordSnapshots)
        .where(eq(bradfordSnapshots.employeeId, data.id));
      await tx
        .delete(bradfordAuditLog)
        .where(eq(bradfordAuditLog.employeeId, data.id));
      await tx.delete(attendance).where(eq(attendance.employeeId, data.id));
      await tx
        .delete(salaryAdvances)
        .where(eq(salaryAdvances.employeeId, data.id));
      await tx
        .delete(travelLogs)
        .where(eq(travelLogs.employeeId, data.id));

      // Finally delete the employee record
      await tx.delete(employees).where(eq(employees.id, data.id));
    });

    return { success: true };
  });

/**
 * Cancel a pending deletion request
 */
export const cancelEmployeeDeletionFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator((data: unknown) => deleteEmployeeSchema.parse(data))
  .handler(async ({ data }) => {
    await db
      .update(employees)
      .set({ status: "active" })
      .where(eq(employees.id, data.id));
    return { success: true };
  });

/**
 * Get all employees pending deletion with stats
 */
export const getEmployeeDeletionRequestsFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .handler(async () => {
    const records = await db.query.employees.findMany({
      where: eq(employees.status, "pending_deletion"),
      orderBy: (t, { desc }) => [desc(t.updatedAt)],
    });

    const [stats] = await db
      .select({
        totalPending: count(),
      })
      .from(employees)
      .where(eq(employees.status, "pending_deletion"));

    return {
      records,
      stats: stats || { totalPending: 0 },
    };
  });
