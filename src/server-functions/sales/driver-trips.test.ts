import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DRIVER_TRIPS_SOURCE = readFileSync(
  join(process.cwd(), "src/server-functions/sales/driver-trips-fn.ts"),
  "utf8",
);

const PAYROLL_CORE_SOURCE = readFileSync(
  join(process.cwd(), "src/server-functions/hr/payroll/core.ts"),
  "utf8",
);

const DIALOG_SOURCE = readFileSync(
  join(process.cwd(), "src/components/sales/create-driver-trip-dialog.tsx"),
  "utf8",
);

const SALES_PEOPLE_PAGE_SOURCE = readFileSync(
  join(process.cwd(), "src/routes/_protected/sales/people/index.tsx"),
  "utf8",
);

describe("Driver Trips & Global System TA/DA Contract", () => {
  it("queries active system tadaRates instead of hardcoding or defaulting to PKR 20", () => {
    expect(DRIVER_TRIPS_SOURCE).toContain("tadaRates");
    expect(DRIVER_TRIPS_SOURCE).toContain("where: eq(tadaRates.isActive, true)");
    expect(DRIVER_TRIPS_SOURCE).toContain("orderBy: [desc(tadaRates.effectiveFrom)]");
    expect(DRIVER_TRIPS_SOURCE).not.toContain("default(20)");
    expect(DRIVER_TRIPS_SOURCE).not.toContain("= 20;");
  });

  it("calculates tadaAmount dynamically from distanceKm and active system ratePerKm", () => {
    expect(DRIVER_TRIPS_SOURCE).toContain("const ratePerKm = parseFloat(activeRate.ratePerKm);");
    expect(DRIVER_TRIPS_SOURCE).toContain(
      "const tadaAmount = (data.distanceKm * ratePerKm).toFixed(2);",
    );
  });

  it("snapshots ratePerKm and tadaAmount to driverTrips on insertion", () => {
    expect(DRIVER_TRIPS_SOURCE).toContain("ratePerKm: ratePerKm.toFixed(2)");
    expect(DRIVER_TRIPS_SOURCE).toContain("tadaAmount");
    expect(DRIVER_TRIPS_SOURCE).toContain("distanceKm: data.distanceKm.toFixed(2)");
  });

  it("auto-syncs driver attendance when trip is created or deleted", () => {
    expect(DRIVER_TRIPS_SOURCE).toContain("syncDriverAttendanceForDate({");
    expect(DRIVER_TRIPS_SOURCE).toContain("await syncDriverAttendanceForDate({");
    expect(DRIVER_TRIPS_SOURCE).toContain("businessDate");
  });

  it("integrates driver TA into monthly payroll payslip calculations", () => {
    expect(PAYROLL_CORE_SOURCE).toContain("db.query.drivers.findFirst");
    expect(PAYROLL_CORE_SOURCE).toContain("db.query.driverTrips.findMany");
    expect(PAYROLL_CORE_SOURCE).toContain("eq(driverTrips.driverId, linkedDriver.id)");
    expect(PAYROLL_CORE_SOURCE).toContain("driverTA");
    expect(PAYROLL_CORE_SOURCE).toContain(
      "(additionalAmounts.incentiveAmount || 0) + tadaAmount + dynamicTA + driverTA",
    );
  });

  it("includes Driver tab in sales people page", () => {
    expect(SALES_PEOPLE_PAGE_SOURCE).toContain('<TabsTrigger value="drivers">Drivers</TabsTrigger>');
    expect(SALES_PEOPLE_PAGE_SOURCE).toContain('<TabsContent value="drivers">');
    expect(SALES_PEOPLE_PAGE_SOURCE).toContain("function DriversTab()");
    expect(SALES_PEOPLE_PAGE_SOURCE).toContain("useGetDrivers");
    expect(SALES_PEOPLE_PAGE_SOURCE).toContain("useGetDriverTrips");
    expect(SALES_PEOPLE_PAGE_SOURCE).toContain("CreateDriverTripDialog");
  });

  it("create-driver-trip-dialog displays live TA/DA preview with system rate", () => {
    expect(DIALOG_SOURCE).toContain("useGetTadaRate");
    expect(DIALOG_SOURCE).toContain("ratePerKm");
    expect(DIALOG_SOURCE).toContain("calculatedTada");
    expect(DIALOG_SOURCE).toContain("Sales > Configurations");
  });
});
