import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { payrolls, employees, payslips, attendance } from "@/db/schemas/hr-schema";
import { wallets, transactions } from "@/db/schemas/finance-schema";
import {
  requireHrManageMiddleware,
  requireHrViewMiddleware,
} from "@/lib/middlewares";
import { z } from "zod";
import { and, desc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { format, parseISO } from "date-fns";
import {
  generateEmployeePayslipCore,
  reversePayslipSideEffects,
  simulateEmployeePayslipCore,
  syncPayrollTotal,
} from "./core";
import { snapshotBradfordForPayroll } from "./bradford-snapshot-fn";
import { rebuildSalesPerformanceLog } from "./sales-performance-fn";
import { createId } from "@paralleldrive/cuid2";
import { getPayrollPeriodFromMonthInput } from "@/lib/payroll-cycle";
import {
  assertPayrollAttendanceCurrent,
  resolvePayrollAttendanceInvalidations,
} from "@/lib/attendance/offline/payroll-invalidation.server";

// ── Status Workflow Validation ────────────────────────────────────────────────
type PayrollStatus = "draft" | "approved" | "paid";
type PayrollAction = "edit" | "delete" | "approve" | "reject" | "pay" | "generate";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const payrollTransitionRules: Record<PayrollStatus, Record<PayrollAction, boolean>> = {
  draft: {
    edit: true,
    delete: true,
    approve: true,
    reject: false,
    pay: false,
    generate: true,
  },
  approved: {
    edit: false,
    delete: false,
    approve: false,
    reject: false,
    pay: true,
    generate: false,
  },
  paid: {
    edit: false,
    delete: false,
    approve: false,
    reject: false,
    pay: false,
    generate: false,
  },
};

const payrollTransitionErrors: Record<`${PayrollStatus}-${PayrollAction}`, string> = {
  "draft-edit": "Draft payroll can be edited.",
  "draft-delete": "Draft payroll can be deleted.",
  "draft-approve": "Draft payroll can be approved once its payslips are finalized.",
  "draft-reject": "Draft payroll cannot be rejected.",
  "draft-pay": "Draft payroll must be approved before payment.",
  "draft-generate": "Draft payroll can generate payslips.",
  "approved-edit": "Approved payroll is locked for editing.",
  "approved-delete": "Approved payroll cannot be deleted.",
  "approved-approve": "Payroll is already approved.",
  "approved-reject": "Approved payroll is immutable. Create a new draft payroll instead.",
  "approved-pay": "Approved payroll can be marked as paid.",
  "approved-generate": "Approved payroll is locked. Return to a draft workflow before regenerating payslips.",
  "paid-edit": "Paid payroll is fully immutable.",
  "paid-delete": "Paid payroll is fully immutable.",
  "paid-approve": "Paid payroll is fully immutable.",
  "paid-reject": "Paid payroll is fully immutable.",
  "paid-pay": "Payroll is already marked as paid.",
  "paid-generate": "Paid payroll is fully immutable.",
};

function validateStatusTransition(
  currentStatus: PayrollStatus,
  action: PayrollAction,
): void {
  const key = `${currentStatus}-${action}` as keyof typeof payrollTransitionErrors;
  if (!payrollTransitionRules[currentStatus][action]) {
    throw new Error(
      payrollTransitionErrors[key] ||
        `Invalid status transition: ${currentStatus} -> ${action}`,
    );
  }
}

async function recalculateLeaveBalancesForPayroll(
  tx: DbTransaction,
  payroll: {
    id: string;
    month: string;
    startDate: string;
    endDate: string;
  },
) {
  const payrollYear = parseISO(payroll.month).getFullYear();
  const yearStart = `${payrollYear}-01-01`;

  const payrollPayslips = await tx.query.payslips.findMany({
    where: eq(payslips.payrollId, payroll.id),
    with: {
      employee: {
        columns: {
          id: true,
          annualLeaveAllowance: true,
        },
      },
    },
  });

  for (const payslip of payrollPayslips) {
    const employee = payslip.employee;
    if (!employee) continue;

    const priorApprovedPayrolls = await tx
      .select({
        startDate: payrolls.startDate,
        endDate: payrolls.endDate,
      })
      .from(payslips)
      .innerJoin(payrolls, eq(payslips.payrollId, payrolls.id))
      .where(
        and(
          eq(payslips.employeeId, employee.id),
          inArray(payrolls.status, ["approved", "paid"]),
          gte(payrolls.month, yearStart),
          lt(payrolls.month, payroll.month),
        ),
      )
      .orderBy(desc(payrolls.month));

    const coveredPeriods = [
      ...priorApprovedPayrolls,
      {
        startDate: payroll.startDate,
        endDate: payroll.endDate,
      },
    ];

    let annualUsed = 0;
    let sickUsed = 0;

    for (const period of coveredPeriods) {
      const leaveRows = await tx.query.attendance.findMany({
        where: and(
          eq(attendance.employeeId, employee.id),
          eq(attendance.status, "leave"),
          eq(attendance.isApprovedLeave, true),
          gte(attendance.date, period.startDate),
          lte(attendance.date, period.endDate),
        ),
        columns: {
          leaveType: true,
        },
      });

      annualUsed += leaveRows.filter((row) => row.leaveType === "annual").length;
      sickUsed += leaveRows.filter((row) => row.leaveType === "sick").length;
    }

    await tx
      .update(employees)
      .set({
        annualLeaveBalance: Math.max(
          0,
          (employee.annualLeaveAllowance ?? 14) - annualUsed,
        ),
        sickLeaveBalance: Math.max(0, 10 - sickUsed),
        leaveYearStart: `${payrollYear}-01-01`,
      })
      .where(eq(employees.id, employee.id));
  }
}

const createPayrollSchema = z.object({
  month: z.string(), // YYYY-MM or YYYY-MM-DD
  employeeIds: z.array(z.string()).optional(),
  processedBy: z.string(),
});

export const createPayrollFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(createPayrollSchema)
  .handler(async ({ data }) => {
    const { processedBy } = data;
    const payrollPeriod = getPayrollPeriodFromMonthInput(data.month);
    const monthDate = parseISO(payrollPeriod.month);

    // Check if payroll already exists for this month
    const existing = await db.query.payrolls.findFirst({
      where: eq(payrolls.month, payrollPeriod.month),
    });
    if (existing) {
      throw new Error(`Payroll for ${format(monthDate, "MMMM yyyy")} already exists (status: ${existing.status})`);
    }

    // 1. Create payroll record (draft status - no payslips generated yet)
    const [payroll] = await db
      .insert(payrolls)
      .values({
        month: payrollPeriod.month,
        startDate: payrollPeriod.startDate,
        endDate: payrollPeriod.endDate,
        status: "draft",
        totalAmount: "0",
        processedBy,
      })
      .returning();

    return {
      payroll,
      message: `Payroll for ${format(monthDate, "MMMM yyyy")} created in draft status. Generate and review payslips, then approve to lock the payroll.`,
    };
  });

/**
 * Generate payslips for a draft payroll.
 * Draft is the editable payroll state.
 */
export const generatePayslipsFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({ payrollId: z.string() }))
  .handler(async ({ data, context }) => {
    const payroll = await db.query.payrolls.findFirst({
      where: eq(payrolls.id, data.payrollId),
    });
    if (!payroll) throw new Error("Payroll not found");

    validateStatusTransition(payroll.status as PayrollStatus, "generate");

    const monthDate = parseISO(payroll.month);
    const today = format(new Date(), "yyyy-MM-dd");
    if (today <= payroll.endDate) {
      throw new Error(
        `Full payroll generation is blocked until ${payroll.endDate}. Use employee early cutoff processing for partial slips.`,
      );
    }

    // Identify employees to process
    const employeesToProcess = await db.query.employees.findMany({
      where: and(
        eq(employees.status, "active"),
        lte(employees.joiningDate, payroll.endDate),
      ),
    });

    const simulationResults = await Promise.all(
      employeesToProcess.map(async (employee) => {
        try {
          await simulateEmployeePayslipCore({
            employeeId: employee.id,
            payrollId: payroll.id,
            payrollPeriod: {
              month: payroll.month,
              startDate: payroll.startDate,
              endDate: payroll.endDate,
            },
          });
          return null;
        } catch (error) {
          return {
            employeeId: employee.id,
            employeeName: `${employee.firstName} ${employee.lastName}`,
            error: error instanceof Error ? error.message : "Unknown error",
          };
        }
      }),
    );
    const simulationErrors = simulationResults.filter(
      (result): result is NonNullable<typeof result> => result !== null,
    );
    if (simulationErrors.length > 0) {
      throw new Error(
        `Payroll generation preflight failed for ${simulationErrors.length} employee(s): ${simulationErrors
          .map((error) => `${error.employeeName}: ${error.error}`)
          .join("; ")}`,
      );
    }

    const generatedPayslipIds: string[] = [];
    try {
      for (const employee of employeesToProcess) {
        const slip = await generateEmployeePayslipCore(
          {
            employeeId: employee.id,
            payrollId: payroll.id,
            payrollPeriod: {
              month: payroll.month,
              startDate: payroll.startDate,
              endDate: payroll.endDate,
            },
          },
          context.session.user.id,
        );
        generatedPayslipIds.push(slip.id);
      }
    } catch (error) {
      if (generatedPayslipIds.length > 0) {
        await db.transaction(async (tx) => {
          for (const payslipId of generatedPayslipIds) {
            await reversePayslipSideEffects(tx, payslipId);
            await tx.delete(payslips).where(eq(payslips.id, payslipId));
          }
        });
      }
      throw error;
    }

    // Update Payroll Total
    const totalAmount = await syncPayrollTotal(db, payroll.id);
    await db.transaction(async (tx) => {
      await resolvePayrollAttendanceInvalidations(
        tx,
        payroll.id,
        context.session.user.id,
      );
    });

    // Rebuild sales performance logs for order bookers / salesmen (non-blocking)
    const yearMonth = format(monthDate, "yyyy-MM");
    for (const emp of employeesToProcess) {
      if (emp.isOrderBooker || emp.isSalesman) {
        try {
          await rebuildSalesPerformanceLog(emp.id, yearMonth);
        } catch (err) {
          console.error(`Performance log failed for ${emp.id}:`, err);
        }
      }
    }

    return {
      totalEmployees: employeesToProcess.length,
      generatedCount: generatedPayslipIds.length,
      failedCount: 0,
      totalAmount,
      message: `Generated ${generatedPayslipIds.length} payslips.`,
    };
  });

/**
 * Get payroll by ID
 */
export const getPayrollByIdFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(z.object({ payrollId: z.string() }))
  .handler(async ({ data }) => {
    return await db.query.payrolls.findFirst({
      where: eq(payrolls.id, data.payrollId),
      with: {
        payslips: {
          with: {
            employee: {
              columns: {
                id: true,
                employeeCode: true,
                firstName: true,
                lastName: true,
                designation: true,
                cnic: true,
                bankName: true,
                bankAccountNumber: true,
              },
            },
          },
        },
        processor: {
          columns: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  });

/**
 * List all payrolls
 */
export const listPayrollsFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(z.object({ limit: z.number().optional().default(50) }))
  .handler(async ({ data }) => {
    return await db.query.payrolls.findMany({
      with: {
        processor: {
          columns: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: (payrolls, { desc }) => [desc(payrolls.month)],
      limit: data.limit,
    });
  });

/**
 * Approve payroll
 */
export const approvePayrollFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({ payrollId: z.string() }))
  .handler(async ({ data }) => {
    return await db.transaction(async (tx) => {
      const current = await tx.query.payrolls.findFirst({
        where: eq(payrolls.id, data.payrollId),
      });
      if (!current) throw new Error("Payroll not found");

      validateStatusTransition(current.status as PayrollStatus, "approve");
      await assertPayrollAttendanceCurrent(tx, data.payrollId);

      const payrollPayslips = await tx.query.payslips.findMany({
        where: eq(payslips.payrollId, data.payrollId),
        columns: { id: true, employeeId: true },
      });

      if (payrollPayslips.length === 0) {
        throw new Error("Cannot approve a payroll that has no payslips.");
      }

      const eligibleEmployees = await tx.query.employees.findMany({
        where: and(
          eq(employees.status, "active"),
          lte(employees.joiningDate, current.endDate),
        ),
        columns: { id: true },
      });
      const uniquePayslipEmployees = new Set(
        payrollPayslips.map((payslip) => payslip.employeeId),
      );
      const payslipEmployeeIds = Array.from(uniquePayslipEmployees);
      const eligibleEmployeeIds = new Set(
        eligibleEmployees.map((employee) => employee.id),
      );
      if (uniquePayslipEmployees.size !== payrollPayslips.length) {
        throw new Error("Cannot approve payroll with duplicate employee payslips.");
      }
      if (payslipEmployeeIds.some((employeeId) => !eligibleEmployeeIds.has(employeeId))) {
        throw new Error("Cannot approve payroll with ineligible employee payslips.");
      }
      if (uniquePayslipEmployees.size !== eligibleEmployees.length) {
        throw new Error(
          `Cannot approve incomplete payroll. Expected ${eligibleEmployees.length} eligible employee payslip(s), found ${uniquePayslipEmployees.size}.`,
        );
      }

      const unresolvedAttendance = await tx.query.attendance.findMany({
        where: and(
          inArray(attendance.employeeId, payslipEmployeeIds),
          gte(attendance.date, current.startDate),
          lte(attendance.date, current.endDate),
          or(
            eq(attendance.leaveApprovalStatus, "pending"),
            and(
              eq(attendance.overtimeStatus, "pending"),
              sql`CAST(${attendance.overtimeHours} AS numeric) > 0`,
            ),
          ),
        ),
        columns: { id: true },
      });
      if (unresolvedAttendance.length > 0) {
        throw new Error(
          `Cannot approve payroll with ${unresolvedAttendance.length} unresolved leave/overtime attendance item(s).`,
        );
      }

      const totalAmount = await syncPayrollTotal(tx, data.payrollId);

      await recalculateLeaveBalancesForPayroll(tx, current);

      const [updated] = await tx
        .update(payrolls)
        .set({
          status: "approved",
          totalAmount,
        })
        .where(eq(payrolls.id, data.payrollId))
        .returning();

      await snapshotBradfordForPayroll(data.payrollId, tx);

      return updated;
    });
  });


export const rejectPayrollFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({ payrollId: z.string() }))
  .handler(async ({ data }) => {
    const current = await db.query.payrolls.findFirst({
      where: eq(payrolls.id, data.payrollId),
    });
    if (!current) throw new Error("Payroll not found");

    validateStatusTransition(current.status as PayrollStatus, "reject");
    throw new Error(
      "Approved payrolls are immutable. Create a new draft payroll instead.",
    );
  });

/**
 * Mark payroll as paid — debits from a finance wallet and logs a ledger transaction.
 */
export const markPayrollAsPaidFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(
    z.object({
      payrollId: z.string(),
      walletId: z.string().min(1, "Please select a payment wallet"),
    }),
  )
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
      const payroll = await tx.query.payrolls.findFirst({
        where: eq(payrolls.id, data.payrollId),
      });

      if (!payroll) throw new Error("Payroll not found");

      validateStatusTransition(payroll.status as PayrollStatus, "pay");
      const [aggregates] = await tx
        .select({
          totalAmount: sql<string>`COALESCE(sum(CAST(${payslips.netSalary} AS numeric)), 0)::text`,
          payslipCount: sql<number>`count(*)::int`,
        })
        .from(payslips)
        .where(eq(payslips.payrollId, data.payrollId));

      if (!aggregates || aggregates.payslipCount === 0) {
        throw new Error("Cannot mark payroll as paid without generated payslips.");
      }

      const payrollAmount = parseFloat(aggregates.totalAmount || "0");
      const payableAmount = Math.max(0, payrollAmount);

      const [claimedPayroll] = await tx
        .update(payrolls)
        .set({
          status: "paid",
          walletId: data.walletId,
          paidAt: new Date(),
          totalAmount: aggregates.totalAmount || "0",
        })
        .where(
          and(
            eq(payrolls.id, data.payrollId),
            eq(payrolls.status, "approved"),
          ),
        )
        .returning();

      if (!claimedPayroll) {
        throw new Error("Only approved payrolls can be marked as paid.");
      }

      let walletName: string;

      if (payableAmount > 0) {
        const [wallet] = await tx
          .update(wallets)
          .set({
            balance: sql`${wallets.balance} - ${payableAmount}`,
          })
          .where(
            and(
              eq(wallets.id, data.walletId),
              gte(wallets.balance, payableAmount.toString()),
            ),
          )
          .returning({
            id: wallets.id,
            name: wallets.name,
          });

        if (!wallet) {
          const existingWallet = await tx.query.wallets.findFirst({
            where: eq(wallets.id, data.walletId),
          });
          if (!existingWallet) throw new Error("Selected wallet not found");

          const currentBalance = parseFloat(existingWallet.balance || "0");
          throw new Error(
            `Insufficient balance in "${existingWallet.name}". Available: PKR ${currentBalance.toLocaleString()}, Required: PKR ${payableAmount.toLocaleString()}`,
          );
        }

        walletName = wallet.name;

        await tx.insert(transactions).values({
          id: createId(),
          walletId: data.walletId,
          type: "debit",
          amount: payableAmount.toString(),
          source: `Payroll - ${format(parseISO(payroll.month), "MMM yyyy")}`,
          referenceId: data.payrollId,
          performedById: context.session.user.id,
        });
      } else {
        const wallet = await tx.query.wallets.findFirst({
          where: eq(wallets.id, data.walletId),
          columns: {
            name: true,
          },
        });
        if (!wallet) throw new Error("Selected wallet not found");
        walletName = wallet.name;
      }

      await tx
        .update(payslips)
        .set({
          paymentSource: walletName,
        })
        .where(eq(payslips.payrollId, data.payrollId));

      return claimedPayroll;
    });
  });

/**
 * Delete a payroll and all its payslips.
 * Also resets any salary advances that were deducted via this payroll's payslips
 * so they can be recovered in the next payroll cycle.
 */
export const deletePayrollFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(z.object({ payrollId: z.string() }))
  .handler(async ({ data }) => {
    const current = await db.query.payrolls.findFirst({
      where: eq(payrolls.id, data.payrollId),
    });
    if (!current) throw new Error("Payroll not found");

    validateStatusTransition(current.status as PayrollStatus, "delete");

    return await db.transaction(async (tx) => {
      const payslipList = await tx.query.payslips.findMany({
        where: eq(payslips.payrollId, data.payrollId),
        columns: { id: true },
      });

      for (const payslip of payslipList) {
        await reversePayslipSideEffects(tx, payslip.id);
      }

      await tx.delete(payslips).where(eq(payslips.payrollId, data.payrollId));

      const [deleted] = await tx
        .delete(payrolls)
        .where(eq(payrolls.id, data.payrollId))
        .returning();

      return deleted;
    });
  });

/**
 * Simulate payroll generation WITHOUT writing to database.
 * Returns preview of all payslips for review before confirmation.
 */
export const simulatePayrollFn = createServerFn()
  .middleware([requireHrManageMiddleware])
  .inputValidator(
    z.object({
      payrollId: z.string().optional(), // If provided, use existing payroll period
      month: z.string().optional(), // If no payrollId, create virtual period
      employeeIds: z.array(z.string()).optional(),
    }),
  )
  .handler(async ({ data }) => {
    let startDate: string;
    let endDate: string;
    let month: string;

    if (data.payrollId) {
      const payroll = await db.query.payrolls.findFirst({
        where: eq(payrolls.id, data.payrollId),
      });
      if (!payroll) throw new Error("Payroll not found");
      startDate = payroll.startDate;
      endDate = payroll.endDate;
      month = payroll.month;
    } else if (data.month) {
      const payrollPeriod = getPayrollPeriodFromMonthInput(data.month);
      month = payrollPeriod.month;
      startDate = payrollPeriod.startDate;
      endDate = payrollPeriod.endDate;
    } else {
      throw new Error("Either payrollId or month must be provided");
    }

    // Identify employees to simulate
    let employeesToProcess;
    if (data.employeeIds && data.employeeIds.length > 0) {
      const ids = data.employeeIds;
      employeesToProcess = await db.query.employees.findMany({
        where: (employees, { inArray }) => inArray(employees.id, ids),
      });
    } else {
      employeesToProcess = await db.query.employees.findMany({
        where: eq(employees.status, "active"),
      });
    }

    // Simulate payslips in parallel
    const simulationPromises = employeesToProcess.map(async (employee) => {
      try {
        return await simulateEmployeePayslipCore({
          employeeId: employee.id,
          payrollId: data.payrollId || "simulation",
          payrollPeriod: { month, startDate, endDate },
        });
      } catch (error) {
        console.error(`Simulation failed for employee ${employee.id}:`, error);
        return {
          error: error instanceof Error ? error.message : "Unknown error",
          employeeId: employee.id,
          employeeName: `${employee.firstName} ${employee.lastName}`,
        };
      }
    });

    const results = await Promise.all(simulationPromises);
    const successful = results.filter((r): r is Exclude<typeof r, { error: string }> => !("error" in r));
    const failed = results.filter((r): r is { error: string; employeeId: string; employeeName: string } => "error" in r);

    const totalNet = successful.reduce(
      (sum, r) => sum + (r.totalNetWithArrears || 0),
      0,
    );
    const totalDeficit = successful.reduce(
      (sum, r) => sum + (r.carriedForwardDeficit || 0),
      0,
    );

    return {
      month,
      startDate,
      endDate,
      totalEmployees: employeesToProcess.length,
      successfulCount: successful.length,
      failedCount: failed.length,
      totalNetSalary: totalNet,
      totalCarriedForwardDeficit: totalDeficit,
      simulations: successful,
      errors: failed,
    };
  });
