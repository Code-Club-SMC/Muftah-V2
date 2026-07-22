import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { payrolls, payslips } from "@/db/schemas/hr-schema";
import {
  requireHrManageMiddleware,
  requireHrViewMiddleware,
} from "@/lib/middlewares";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { generateEmployeePayslipCore, syncPayrollTotal } from "./core";

/**
 * Generate payslip for a single employee
 */
export const generateEmployeePayslipFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(
    z.object({
      employeeId: z.string(),
      payrollId: z.string(),
      payrollPeriod: z.object({
        month: z.string(), // YYYY-MM-DD
        startDate: z.string(), // YYYY-MM-DD
        endDate: z.string(), // YYYY-MM-DD
      }),
      deductionConfig: z
        .object({
          manualDeductions: z.array(
            z.object({
              description: z.string(),
              amount: z.number(),
            }),
          ),
          deductConveyanceOnLeave: z.boolean(),
        })
        .optional(),
      additionalAmounts: z
        .object({
          overtimeAmount: z.number().optional(),
          nightShiftAllowance: z.number().optional(),
          incentiveAmount: z.number().optional(),
          bonusAmount: z.number().optional(),
          advanceDeduction: z.number().optional(),
          taxDeduction: z.number().optional(),
        })
        .optional(),
      arrears: z
        .object({
          arrearsAmount: z.number(),
          arrearsFromMonths: z.array(z.string()),
        })
        .optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const payroll = await db.query.payrolls.findFirst({
      where: eq(payrolls.id, data.payrollId),
    });
    if (!payroll) {
      throw new Error("Payroll not found");
    }
    if (payroll.status !== "draft") {
      throw new Error("Only draft payrolls can generate or regenerate payslips.");
    }

    const result = await generateEmployeePayslipCore(data, context.session.user.id);
    const payrollTotalAmount = await syncPayrollTotal(db, data.payrollId);

    return {
      ...result,
      payrollTotalAmount,
    };
  });

/**
 * Get payslip by ID with full details
 */
export const getPayslipByIdFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(z.object({ payslipId: z.string() }))
  .handler(async ({ data }) => {
    const payslip = await db.query.payslips.findFirst({
      where: eq(payslips.id, data.payslipId),
      with: {
        employee: true,
        payroll: true,
      },
    });

    if (!payslip) {
      throw new Error(`Payslip with ID ${data.payslipId} not found`);
    }

    return payslip;
  });

/**
 * Get all payslips for a payroll
 */
export const getPayslipsByPayrollFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(z.object({ payrollId: z.string() }))
  .handler(async ({ data }) => {
    return await db.query.payslips.findMany({
      where: eq(payslips.payrollId, data.payrollId),
      with: {
        employee: {
          columns: {
            id: true,
            employeeCode: true,
            firstName: true,
            lastName: true,
            designation: true,
          },
        },
      },
      orderBy: (payslips, { asc }) => [asc(payslips.createdAt)],
    });
  });

/**
 * Get employee's payslip history
 */
export const getEmployeePayslipHistoryFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(
    z.object({
      employeeId: z.string(),
      limit: z.number().optional().default(12),
    }),
  )
  .handler(async ({ data }) => {
    return await db.query.payslips.findMany({
      where: eq(payslips.employeeId, data.employeeId),
      with: {
        payroll: {
          columns: {
            id: true,
            month: true,
            startDate: true,
            endDate: true,
            status: true,
          },
        },
      },
      orderBy: (payslips, { desc }) => [desc(payslips.createdAt)],
      limit: data.limit,
    });
  });
