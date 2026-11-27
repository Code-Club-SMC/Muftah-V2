import { createServerFn } from "@tanstack/react-start";
import Big from "big.js";
import { db } from "@/db";
import { requireReportsViewMiddleware } from "@/lib/middlewares";
import { payslips, payrolls, employees } from "@/db/schemas/hr-schema";
import { z } from "zod";
import { and, asc, eq, gte, lte, sql, desc } from "drizzle-orm";
import { firstDayOfPayrollMonth, slipPaymentState } from "@/lib/hr/salary-payments";
import { loadActivePaymentsForPayrolls, paidFromText, slipKey } from "@/server-functions/hr/payroll/salary-payments.server";

export const getSalariesReportFn = createServerFn()
  .middleware([requireReportsViewMiddleware])
  .inputValidator((input: any) =>
    z
      .object({
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    // Slips are selected by payroll month: a month is in range when its first day falls between
    // the first day of dateFrom's month and dateTo.
    const conditions = [];
    if (data.dateFrom) conditions.push(gte(payrolls.month, firstDayOfPayrollMonth(data.dateFrom)));
    if (data.dateTo) conditions.push(lte(payrolls.month, data.dateTo.slice(0, 10)));

    const rows = await db
      .select({
        payslipId: payslips.id,
        payrollId: payrolls.id,
        employeeId: payslips.employeeId,
        employeeName: sql<string>`${employees.firstName} || ' ' || ${employees.lastName}`,
        employeeCode: employees.employeeCode,
        designation: employees.designation,
        department: employees.department,
        payrollMonth: payrolls.month,
        daysPresent: payslips.daysPresent,
        daysAbsent: payslips.daysAbsent,
        daysLeave: payslips.daysLeave,
        basicSalary: payslips.basicSalary,
        allowanceBreakdown: payslips.allowanceBreakdown,
        incentiveAmount: payslips.incentiveAmount,
        commissionAmount: payslips.commissionAmount,
        overtimeAmount: payslips.overtimeAmount,
        nightShiftAllowanceAmount: payslips.nightShiftAllowanceAmount,
        bonusAmount: payslips.bonusAmount,
        grossSalary: payslips.grossSalary,
        absentDeduction: payslips.absentDeduction,
        leaveDeduction: payslips.leaveDeduction,
        notEmployedDeduction: payslips.notEmployedDeduction,
        advanceDeduction: payslips.advanceDeduction,
        taxDeduction: payslips.taxDeduction,
        otherDeduction: payslips.otherDeduction,
        totalDeductions: payslips.totalDeductions,
        netSalary: payslips.netSalary,
        arrearsAmount: payslips.arrearsAmount,
        arrearsFromMonths: payslips.arrearsFromMonths,
        paidAt: payrolls.paidAt,
      })
      .from(payslips)
      .innerJoin(payrolls, eq(payslips.payrollId, payrolls.id))
      .innerJoin(employees, eq(payslips.employeeId, employees.id))
      .where(and(...conditions))
      .orderBy(desc(payrolls.month), asc(employees.employeeCode));

    const payments = await loadActivePaymentsForPayrolls(db, [...new Set(rows.map((r) => r.payrollId))]);
    const withPayments = rows.map((r) => {
      const slipRows = payments.get(slipKey(r.payrollId, r.employeeId)) ?? [];
      const state = slipPaymentState(r.netSalary, slipRows);
      return { ...r, paidFrom: paidFromText(slipRows), paid: Number(state.paid), due: Number(state.due) };
    });
    const totalPaid = Number(withPayments.reduce((s, r) => s.plus(r.paid), new Big(0)).toFixed(2));
    const totalDue = Number(withPayments.reduce((s, r) => s.plus(r.due), new Big(0)).toFixed(2));

    const totalGross = rows.reduce((s, r) => s + Number(r.grossSalary), 0);
    const totalDeductions = rows.reduce(
      (s, r) => s + Number(r.totalDeductions),
      0,
    );
    const totalNet = rows.reduce((s, r) => s + Number(r.netSalary), 0);
    const totalArrears = rows.reduce((s, r) => s + Number(r.arrearsAmount), 0);

    return {
      payslips: withPayments.map((r) => ({
        ...r,
        basicSalary: Number(r.basicSalary),
        incentiveAmount: Number(r.incentiveAmount),
        commissionAmount: Number(r.commissionAmount),
        overtimeAmount: Number(r.overtimeAmount),
        nightShiftAllowanceAmount: Number(r.nightShiftAllowanceAmount),
        bonusAmount: Number(r.bonusAmount),
        grossSalary: Number(r.grossSalary),
        absentDeduction: Number(r.absentDeduction),
        leaveDeduction: Number(r.leaveDeduction),
        notEmployedDeduction: Number(r.notEmployedDeduction),
        advanceDeduction: Number(r.advanceDeduction),
        taxDeduction: Number(r.taxDeduction),
        otherDeduction: Number(r.otherDeduction),
        totalDeductions: Number(r.totalDeductions),
        netSalary: Number(r.netSalary),
        arrearsAmount: Number(r.arrearsAmount),
      })),
      summary: {
        totalGross,
        totalDeductions,
        totalNet,
        totalArrears,
        totalPaid,
        totalDue,
        count: rows.length,
      },
    };
  });
