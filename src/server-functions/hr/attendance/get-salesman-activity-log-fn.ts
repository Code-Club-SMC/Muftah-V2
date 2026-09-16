import { createServerFn } from "@tanstack/react-start";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { addDays, eachDayOfInterval, format, parseISO } from "date-fns";
import { z } from "zod";
import { db } from "@/db";
import { attendance, employees } from "@/db/schemas/hr-schema";
import {
  creditRecoveryAttempts,
  orders,
  salesmen,
} from "@/db/schemas/sales-erp-schema";
import { requireHrViewMiddleware } from "@/lib/middlewares";
import { toPKTDate } from "@/lib/attendance/time";
import { getSalesmanBusinessDateRange } from "@/server-functions/sales/salesman-attendance-sync";

export type SalesmanActivityStatus =
  | "present"
  | "pending_review"
  | "rest_day"
  | "absent"
  | "leave"
  | "holiday";

export type SalesmanActivityDay = {
  date: string;
  weekday: string;
  status: SalesmanActivityStatus;
  attendanceStatus: "present" | "absent" | "leave" | "holiday" | null;
  attendanceEntrySource: string | null;
  isRestDay: boolean;
  deliveryCount: number;
  recoveryCount: number;
  totalDeliveredAmount: number;
  totalRecoveredAmount: number;
  deliveries: {
    id: string;
    billNumber: string | null;
    customerName: string;
    totalAmount: number;
    status: string;
  }[];
  recoveries: {
    id: string;
    slipNumber: string | null;
    customerName: string;
    attemptOutcome: string;
    amountPromised: number;
    notes: string | null;
  }[];
  notes: string[];
};

export function resolveSalesmanActivityStatus(args: {
  attendanceRow: { status: "present" | "absent" | "leave" | "holiday" } | null | undefined;
  isRestDay: boolean;
  activityCount: number;
}): SalesmanActivityStatus {
  if (
    args.attendanceRow?.status === "absent" ||
    args.attendanceRow?.status === "leave" ||
    args.attendanceRow?.status === "holiday"
  ) {
    return args.attendanceRow.status;
  }

  if (args.attendanceRow?.status === "present" || args.activityCount > 0) {
    return "present";
  }

  if (args.isRestDay) return "rest_day";

  return "pending_review";
}

export const getSalesmanActivityLogFn = createServerFn()
  .middleware([requireHrViewMiddleware])
  .inputValidator((input: unknown) =>
    z
      .object({
        employeeId: z.string().min(1),
        startDate: z.string().min(1),
        endDate: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const { employeeId, startDate, endDate } = data;

    if (startDate > endDate) {
      throw new Error("Start date cannot be after end date.");
    }

    const employee = await db.query.employees.findFirst({
      where: eq(employees.id, employeeId),
      columns: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        designation: true,
        restDays: true,
        isSalesman: true,
      },
    });

    if (!employee) throw new Error("Employee not found.");
    if (!employee.isSalesman) {
      throw new Error("Employee is not a salesman.");
    }

    const salesman = await db.query.salesmen.findFirst({
      where: eq(salesmen.employeeId, employeeId),
      columns: {
        id: true,
        name: true,
        phone: true,
        status: true,
      },
    });

    if (!salesman) {
      throw new Error("No salesman profile is linked to this employee.");
    }

    const attendanceEndExclusive = format(
      addDays(parseISO(endDate), 1),
      "yyyy-MM-dd",
    );

    const attendanceRows = await db.query.attendance.findMany({
      where: and(
        eq(attendance.employeeId, employeeId),
        gte(attendance.date, startDate),
        lt(attendance.date, attendanceEndExclusive),
      ),
      orderBy: asc(attendance.date),
      columns: {
        date: true,
        status: true,
        entrySource: true,
        notes: true,
      },
    });

    const attendanceByDate = new Map(
      attendanceRows.map((row) => [row.date, row]),
    );

    const rangeStart = getSalesmanBusinessDateRange(startDate).start;
    const rangeEnd = getSalesmanBusinessDateRange(endDate).endExclusive;

    const [deliveredOrders, recoveries] = await Promise.all([
      db.query.orders.findMany({
        where: and(
          eq(orders.fulfilledBySalesmanId, salesman.id),
          eq(orders.status, "delivered"),
          gte(orders.fulfilledAt, rangeStart),
          lt(orders.fulfilledAt, rangeEnd),
        ),
        orderBy: asc(orders.fulfilledAt),
        with: {
          customer: {
            columns: { id: true, name: true },
          },
          items: {
            columns: { id: true, amount: true },
          },
        },
      }),
      db.query.creditRecoveryAttempts.findMany({
        where: and(
          eq(creditRecoveryAttempts.assignedToId, salesman.id),
          gte(creditRecoveryAttempts.attemptedAt, rangeStart),
          lt(creditRecoveryAttempts.attemptedAt, rangeEnd),
        ),
        orderBy: asc(creditRecoveryAttempts.attemptedAt),
        with: {
          slip: {
            columns: { id: true, slipNumber: true, outstandingAmount: true },
            with: {
              customer: {
                columns: { id: true, name: true },
              },
            },
          },
        },
      }),
    ]);

    const ordersByDate = new Map<string, typeof deliveredOrders>();
    for (const order of deliveredOrders) {
      if (!order.fulfilledAt) continue;
      const date = toPKTDate(order.fulfilledAt);
      const list = ordersByDate.get(date) ?? [];
      list.push(order);
      ordersByDate.set(date, list);
    }

    const recoveriesByDate = new Map<string, typeof recoveries>();
    for (const recovery of recoveries) {
      const date = toPKTDate(recovery.attemptedAt);
      const list = recoveriesByDate.get(date) ?? [];
      list.push(recovery);
      recoveriesByDate.set(date, list);
    }

    const restDays = employee.restDays ?? [0];
    const dates = eachDayOfInterval({
      start: parseISO(startDate),
      end: parseISO(endDate),
    });

    const rows: SalesmanActivityDay[] = dates.map((day) => {
      const date = format(day, "yyyy-MM-dd");
      const dayOrders = ordersByDate.get(date) ?? [];
      const dayRecoveries = recoveriesByDate.get(date) ?? [];
      const attendanceRow = attendanceByDate.get(date);

      const totalDeliveredAmount = dayOrders.reduce((sum, o) => {
        const orderTotal = o.items.reduce(
          (iSum, item) => iSum + Number(item.amount || 0),
          0,
        );
        return sum + orderTotal;
      }, 0);

      const totalRecoveredAmount = dayRecoveries.reduce((sum, r) => {
        return sum + Number(r.amountPromised || 0);
      }, 0);

      const activityCount = dayOrders.length + dayRecoveries.length;
      const isRest = restDays.includes(day.getDay());
      const status = resolveSalesmanActivityStatus({
        attendanceRow: attendanceRow
          ? { status: attendanceRow.status as any }
          : null,
        isRestDay: isRest,
        activityCount,
      });

      const notes: string[] = [];
      if (attendanceRow?.notes) notes.push(attendanceRow.notes);

      return {
        date,
        weekday: format(day, "EEE"),
        status,
        attendanceStatus: (attendanceRow?.status as any) ?? null,
        attendanceEntrySource: attendanceRow?.entrySource ?? null,
        isRestDay: isRest,
        deliveryCount: dayOrders.length,
        recoveryCount: dayRecoveries.length,
        totalDeliveredAmount,
        totalRecoveredAmount,
        deliveries: dayOrders.map((o) => ({
          id: o.id,
          billNumber: o.billNumber ? String(o.billNumber) : o.id.slice(0, 8),
          customerName: o.shopkeeperName || "Direct Shop",
          totalAmount: o.items.reduce(
            (sum, item) => sum + Number(item.amount || 0),
            0,
          ),
          status: o.status,
        })),
        recoveries: dayRecoveries.map((r) => ({
          id: r.id,
          slipNumber: r.slip?.slipNumber || r.id.slice(0, 8),
          customerName: r.slip?.customer?.name || "Customer",
          attemptOutcome: r.attemptOutcome,
          amountPromised: Number(r.amountPromised || 0),
          notes: r.notes,
        })),
        notes,
      };
    });

    const summary = rows.reduce(
      (acc, r) => {
        acc.totalDeliveries += r.deliveryCount;
        acc.totalRecoveries += r.recoveryCount;
        acc.totalDeliveredAmount += r.totalDeliveredAmount;
        acc.totalRecoveredAmount += r.totalRecoveredAmount;
        if (r.status === "present") acc.presentDays += 1;
        if (r.status === "rest_day") acc.restDays += 1;
        if (r.status === "absent") acc.absentDays += 1;
        if (r.status === "leave") acc.leaveDays += 1;
        if (r.status === "holiday") acc.holidayDays += 1;
        if (r.status === "pending_review") acc.pendingDays += 1;
        return acc;
      },
      {
        totalDeliveries: 0,
        totalRecoveries: 0,
        totalDeliveredAmount: 0,
        totalRecoveredAmount: 0,
        presentDays: 0,
        restDays: 0,
        absentDays: 0,
        leaveDays: 0,
        holidayDays: 0,
        pendingDays: 0,
      },
    );

    return {
      employee: {
        id: employee.id,
        name: `${employee.firstName} ${employee.lastName}`.trim(),
        employeeCode: employee.employeeCode,
        designation: employee.designation,
        salesmanId: salesman.id,
        phone: salesman.phone,
        status: salesman.status,
      },
      dateRange: { startDate, endDate },
      summary,
      days: rows,
    };
  });
