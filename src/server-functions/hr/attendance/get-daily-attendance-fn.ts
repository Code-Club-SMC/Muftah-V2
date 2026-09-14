import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { requireHrViewMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { and, asc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { attendancePunches, employees } from "@/db/schemas/hr-schema";
import {
  creditRecoveryAttempts,
  orders,
  salesmen,
} from "@/db/schemas/sales-erp-schema";
import { getSalesmanBusinessDateRange } from "@/server-functions/sales/salesman-attendance-sync";

export const getDailyAttendanceFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator(z.object({ date: z.string() }))
  .handler(async ({ data }) => {
    const { date } = data;

    const allEmployees = await db.query.employees.findMany({
      where: and(
        inArray(employees.status, ["active", "on_leave"]),
        lte(employees.joiningDate, date),
      ),
      with: {
        attendance: {
          where: (table, { eq }) => eq(table.date, date),
        },
      },
      orderBy: (table, { asc }) => [asc(table.firstName), asc(table.lastName)],
    });

    const punchDrivenEmployeeIds = allEmployees
      .filter((employee) => !employee.isOrderBooker && !employee.isSalesman)
      .map((employee) => employee.id);

    const punches =
      punchDrivenEmployeeIds.length > 0
        ? await db.query.attendancePunches.findMany({
            where: and(
              inArray(attendancePunches.employeeId, punchDrivenEmployeeIds),
              eq(attendancePunches.attendanceDate, date),
            ),
            orderBy: [asc(attendancePunches.timestamp)],
          })
        : [];

    const punchesByEmployee = new Map<string, typeof punches>();
    for (const punch of punches) {
      const current = punchesByEmployee.get(punch.employeeId) ?? [];
      current.push(punch);
      punchesByEmployee.set(punch.employeeId, current);
    }

    // Activity tracking for salesmen
    const salesmanEmployees = allEmployees.filter((e) => e.isSalesman);
    const salesmanEmployeeIds = salesmanEmployees.map((e) => e.id);

    const linkedSalesmen =
      salesmanEmployeeIds.length > 0
        ? await db.query.salesmen.findMany({
            where: inArray(salesmen.employeeId, salesmanEmployeeIds),
            columns: { id: true, employeeId: true },
          })
        : [];

    const salesmanIdToEmployeeId = new Map(
      linkedSalesmen.map((s) => [s.id, s.employeeId!]),
    );
    const salesmanIds = linkedSalesmen.map((s) => s.id);

    const { start, endExclusive } = getSalesmanBusinessDateRange(date);

    const [deliveries, recoveries] =
      salesmanIds.length > 0
        ? await Promise.all([
            db
              .select({
                salesmanId: orders.fulfilledBySalesmanId,
                count: sql<number>`count(*)`,
              })
              .from(orders)
              .where(
                and(
                  inArray(orders.fulfilledBySalesmanId, salesmanIds),
                  eq(orders.status, "delivered"),
                  gte(orders.fulfilledAt, start),
                  lt(orders.fulfilledAt, endExclusive),
                ),
              )
              .groupBy(orders.fulfilledBySalesmanId),
            db
              .select({
                salesmanId: creditRecoveryAttempts.assignedToId,
                count: sql<number>`count(*)`,
              })
              .from(creditRecoveryAttempts)
              .where(
                and(
                  inArray(creditRecoveryAttempts.assignedToId, salesmanIds),
                  gte(creditRecoveryAttempts.attemptedAt, start),
                  lt(creditRecoveryAttempts.attemptedAt, endExclusive),
                ),
              )
              .groupBy(creditRecoveryAttempts.assignedToId),
          ])
        : [[], []];

    const deliveryCountByEmployee = new Map<string, number>();
    for (const delivery of deliveries) {
      if (delivery.salesmanId) {
        const empId = salesmanIdToEmployeeId.get(delivery.salesmanId);
        if (empId) {
          deliveryCountByEmployee.set(empId, Number(delivery.count));
        }
      }
    }

    const recoveryCountByEmployee = new Map<string, number>();
    for (const recovery of recoveries) {
      if (recovery.salesmanId) {
        const empId = salesmanIdToEmployeeId.get(recovery.salesmanId);
        if (empId) {
          recoveryCountByEmployee.set(empId, Number(recovery.count));
        }
      }
    }

    return allEmployees.map((employee) => ({
      ...employee,
      dailyPunches: punchesByEmployee.get(employee.id) ?? [],
      salesmanActivity: employee.isSalesman
        ? {
            deliveriesCount: deliveryCountByEmployee.get(employee.id) ?? 0,
            recoveryCount: recoveryCountByEmployee.get(employee.id) ?? 0,
          }
        : undefined,
    }));
  });
