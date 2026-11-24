import { eq } from "drizzle-orm";
import type { db } from "@/db";
import { employees } from "@/db/schemas/hr-schema";
import { drivers, orderBookers, salesmen } from "@/db/schemas/sales-erp-schema";
import { syncDriverAttendanceForDate } from "@/server-functions/hr/attendance/driver-attendance-sync";
import { syncOrderBookerAttendanceForDate } from "@/server-functions/sales/order-booker-trip-sync";
import { syncSalesmanAttendanceForDate } from "@/server-functions/sales/salesman-attendance-sync";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// After an import is undone, trips, deliveries and recoveries decide the day again.
export async function restoreFieldActivityAttendance(
  tx: Tx,
  employeeId: string,
  businessDate: string,
) {
  const employee = await tx.query.employees.findFirst({
    where: eq(employees.id, employeeId),
  });
  if (!employee) return;
  const columns = { id: true } as const;
  const standardDutyHours = employee.standardDutyHours;
  if (employee.isOrderBooker) {
    const booker = await tx.query.orderBookers.findFirst({
      columns,
      where: eq(orderBookers.employeeId, employeeId),
    });
    if (booker)
      await syncOrderBookerAttendanceForDate({
        tx,
        employeeId,
        orderBookerId: booker.id,
        businessDate,
        standardDutyHours,
      });
  }
  if (employee.isSalesman) {
    const salesman = await tx.query.salesmen.findFirst({
      columns,
      where: eq(salesmen.employeeId, employeeId),
    });
    if (salesman)
      await syncSalesmanAttendanceForDate({
        tx,
        salesmanId: salesman.id,
        businessDate,
        standardDutyHours,
      });
  }
  if (employee.isDriver) {
    const driver = await tx.query.drivers.findFirst({
      columns,
      where: eq(drivers.employeeId, employeeId),
    });
    if (driver)
      await syncDriverAttendanceForDate({
        tx,
        driverId: driver.id,
        businessDate,
        standardDutyHours,
      });
  }
}
