import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveSalesmanActivityStatus } from "@/server-functions/hr/attendance/get-salesman-activity-log-fn";
import { resolveDriverActivityStatus } from "@/server-functions/hr/attendance/get-driver-activity-log-fn";

describe("salesman and driver activity status resolution", () => {
  describe("resolveSalesmanActivityStatus", () => {
    it("returns leave, absent, or holiday directly if explicitly recorded", () => {
      expect(
        resolveSalesmanActivityStatus({
          attendanceRow: { status: "absent" },
          isRestDay: false,
          activityCount: 5,
        }),
      ).toBe("absent");

      expect(
        resolveSalesmanActivityStatus({
          attendanceRow: { status: "leave" },
          isRestDay: false,
          activityCount: 0,
        }),
      ).toBe("leave");

      expect(
        resolveSalesmanActivityStatus({
          attendanceRow: { status: "holiday" },
          isRestDay: false,
          activityCount: 0,
        }),
      ).toBe("holiday");
    });

    it("returns present if explicitly recorded as present or if field activities exist", () => {
      expect(
        resolveSalesmanActivityStatus({
          attendanceRow: { status: "present" },
          isRestDay: false,
          activityCount: 0,
        }),
      ).toBe("present");

      expect(
        resolveSalesmanActivityStatus({
          attendanceRow: null,
          isRestDay: false,
          activityCount: 2,
        }),
      ).toBe("present");
    });

    it("returns rest_day on unworked rest day", () => {
      expect(
        resolveSalesmanActivityStatus({
          attendanceRow: null,
          isRestDay: true,
          activityCount: 0,
        }),
      ).toBe("rest_day");
    });

    it("returns pending_review if no record, no activity, and not a rest day", () => {
      expect(
        resolveSalesmanActivityStatus({
          attendanceRow: null,
          isRestDay: false,
          activityCount: 0,
        }),
      ).toBe("pending_review");
    });
  });

  describe("resolveDriverActivityStatus", () => {
    it("returns leave, absent, or holiday directly if explicitly recorded", () => {
      expect(
        resolveDriverActivityStatus({
          attendanceRow: { status: "absent" },
          isRestDay: false,
          tripCount: 3,
        }),
      ).toBe("absent");

      expect(
        resolveDriverActivityStatus({
          attendanceRow: { status: "leave" },
          isRestDay: false,
          tripCount: 0,
        }),
      ).toBe("leave");
    });

    it("returns present if explicitly recorded as present or if trips exist", () => {
      expect(
        resolveDriverActivityStatus({
          attendanceRow: { status: "present" },
          isRestDay: false,
          tripCount: 0,
        }),
      ).toBe("present");

      expect(
        resolveDriverActivityStatus({
          attendanceRow: null,
          isRestDay: false,
          tripCount: 1,
        }),
      ).toBe("present");
    });

    it("returns rest_day on unworked rest day", () => {
      expect(
        resolveDriverActivityStatus({
          attendanceRow: null,
          isRestDay: true,
          tripCount: 0,
        }),
      ).toBe("rest_day");
    });

    it("returns pending_review if no trip and not a rest day", () => {
      expect(
        resolveDriverActivityStatus({
          attendanceRow: null,
          isRestDay: false,
          tripCount: 0,
        }),
      ).toBe("pending_review");
    });
  });
});

describe("edit attendance form field worker logic", () => {
  const source = readFileSync(
    "src/components/hr/attendance/edit-attendance-form.tsx",
    "utf8",
  );

  it("treats salesman and driver as field workers along with order bookers", () => {
    expect(source).toContain("isSalesman?: boolean");
    expect(source).toContain("isDriver?: boolean");
    expect(source).toContain(
      "const isFieldWorker = isOrderBooker || isSalesman || isDriver",
    );
  });

  it("considers present punches loaded immediately for field workers", () => {
    expect(source).toContain(
      "const [presentPunchesLoaded, setPresentPunchesLoaded] = useState(\n    isFieldWorker ? true : false,\n  )",
    );
  });

  it("disables punch-driven overtime sync and manual punch timeline for field workers", () => {
    expect(source).toContain("isPunchDrivenPresentStaff");
    expect(source).toContain("value.status === \"present\" && !isFieldWorker");
    expect(source).toContain("!isFieldWorker && (");
  });
});

describe("salesman and driver activity log components", () => {
  const salesmanSource = readFileSync(
    "src/components/hr/attendance/salesman-attendance-log.tsx",
    "utf8",
  );
  const driverSource = readFileSync(
    "src/components/hr/attendance/driver-attendance-log.tsx",
    "utf8",
  );
  const tableSource = readFileSync(
    "src/components/hr/attendance/attendance-list-table.tsx",
    "utf8",
  );
  const employeeDetailSource = readFileSync(
    "src/components/hr/employees/employee-detail-view.tsx",
    "utf8",
  );
  const attendanceLogViewSource = readFileSync(
    "src/components/hr/attendance/attendance-log-view.tsx",
    "utf8",
  );

  it("salesman log component queries getSalesmanActivityLogFn and renders deliveries/recoveries", () => {
    expect(salesmanSource).toContain("getSalesmanActivityLogFn");
    expect(salesmanSource).toContain('"salesman-activity-log"');
    expect(salesmanSource).toContain('header: "Deliveries"');
    expect(salesmanSource).toContain('header: "Credit Recoveries"');
    expect(salesmanSource).toContain('header: "Delivered Value"');
    expect(salesmanSource).toContain('header: "Recovered / Promised"');
  });

  it("driver log component queries getDriverActivityLogFn and renders trips/destinations/tada", () => {
    expect(driverSource).toContain("getDriverActivityLogFn");
    expect(driverSource).toContain('"driver-activity-log"');
    expect(driverSource).toContain('header: "Trips"');
    expect(driverSource).toContain('header: "Destinations"');
    expect(driverSource).toContain('header: "Vehicle(s)"');
    expect(driverSource).toContain('header: "Distance (KM)"');
    expect(driverSource).toContain('header: "TA/DA Compensation"');
  });

  it("attendance list table links to salesman and driver detail pages", () => {
    expect(tableSource).toContain('to="/hr/salesman-details/$employeeId"');
    expect(tableSource).toContain('to="/hr/driver-details/$employeeId"');
  });

  it("employee detail view polymorphically renders role-specific logs", () => {
    expect(employeeDetailSource).toContain("OrderBookerAttendanceLog");
    expect(employeeDetailSource).toContain("SalesmanAttendanceLog");
    expect(employeeDetailSource).toContain("DriverAttendanceLog");
  });

  it("attendance log view polymorphically renders role-specific logs", () => {
    expect(attendanceLogViewSource).toContain("OrderBookerAttendanceLog");
    expect(attendanceLogViewSource).toContain("SalesmanAttendanceLog");
    expect(attendanceLogViewSource).toContain("DriverAttendanceLog");
  });
});
