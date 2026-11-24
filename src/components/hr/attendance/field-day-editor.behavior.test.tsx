import { Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ permissions: ["hr.manage"] as string[], log: vi.fn(), daily: vi.fn(), sheet: vi.fn(), error: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useParams: () => ({}) }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("@/hooks/use-viewer-access", () => ({ useViewerAccess: () => ({ data: { permissions: mocks.permissions } }) }));
vi.mock("@/lib/attendance/time", () => ({ nowPKTDate: () => "2026-11-05" }));
vi.mock("@/server-functions/hr/attendance/get-salesman-activity-log-fn", () => ({ getSalesmanActivityLogFn: mocks.log }));
vi.mock("@/server-functions/hr/attendance/get-order-booker-activity-log-fn", () => ({ getOrderBookerActivityLogFn: mocks.log }));
vi.mock("@/server-functions/hr/attendance/get-driver-activity-log-fn", () => ({ getDriverActivityLogFn: mocks.log }));
vi.mock("@/server-functions/hr/attendance/get-daily-attendance-fn", () => ({ getDailyAttendanceFn: mocks.daily }));
vi.mock("./edit-attendance-sheet", () => ({
  EditAttendanceSheet: (props: { date: string; onOpenChange: (open: boolean) => void }) => {
    mocks.sheet(props);
    return <button type="button" onClick={() => props.onOpenChange(false)}>Close {props.date}</button>;
  },
}));

import { DriverAttendanceLog } from "./driver-attendance-log";
import { OrderBookerAttendanceLog } from "./order-booker-attendance-log";
import { SalesmanAttendanceLog } from "./salesman-attendance-log";

const day = (date: string, attendanceStatus: string | null, isRestDay = false) => ({
  date, weekday: "Day", status: attendanceStatus ?? (isRestDay ? "rest_day" : "pending_review"), attendanceStatus, attendanceEntrySource: null, isRestDay,
  tripCount: 0, totalDistanceKm: 0, totalTadaAmount: 0, destinations: [], vehicleNumbers: [], trips: [], notes: [],
});
const open = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Suspense fallback="Loading"><DriverAttendanceLog employeeId="d1" startDate="2026-10-28" endDate="2026-11-06" /></Suspense>
    </QueryClientProvider>,
  );
const button = (date: string) => screen.queryByRole("button", { name: `Edit attendance on ${date}` });

describe("editing a driver's day", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.permissions = ["hr.manage"];
    mocks.log.mockResolvedValue({
      employee: { id: "d1", name: "Rahmat Wali", employeeCode: "113016", designation: "Driver", joiningDate: "2026-10-29", status: "active" },
      summary: { presentDays: 0, pendingDays: 0, totalTrips: 0, totalDistanceKm: 0, totalTadaAmount: 0 },
      days: [day("2026-10-28", null), day("2026-10-29", null), day("2026-10-30", null, true), day("2026-11-01", "present"), day("2026-11-06", null)],
    });
    mocks.daily.mockResolvedValue([{ id: "other", attendance: [] }, { id: "d1", isDriver: true, attendance: [{ status: "present", notes: "Do as per policy" }] }]);
  });

  it("opens the full record of the chosen day and can be used again", async () => {
    open();
    await screen.findByText("Rahmat Wali");
    expect(button("29 Oct 2026")?.textContent).toBe("Mark");
    expect(button("01 Nov 2026")?.textContent).toBe("Edit");
    fireEvent.click(button("01 Nov 2026")!);
    fireEvent.click(await screen.findByRole("button", { name: "Close 2026-11-01" }));
    expect(mocks.daily).toHaveBeenCalledWith({ data: { date: "2026-11-01" } });
    expect(mocks.sheet.mock.calls[0][0]).toMatchObject({ date: "2026-11-01", employee: { id: "d1" }, attendance: { notes: "Do as per policy" } });
    fireEvent.click(button("29 Oct 2026")!);
    expect(await screen.findByRole("button", { name: "Close 2026-10-29" })).toBeTruthy();
  });

  it("offers nothing for future days, days before joining and unworked rest days", async () => {
    open();
    await screen.findByText("Rahmat Wali");
    for (const date of ["28 Oct 2026", "30 Oct 2026", "06 Nov 2026"]) expect(button(date)).toBeNull();
  });

  it("is hidden from people who can only view", async () => {
    mocks.permissions = ["hr.view"];
    open();
    await screen.findByText("Rahmat Wali");
    expect(button("01 Nov 2026")).toBeNull();
  });

  it("says so when the driver is no longer active", async () => {
    mocks.daily.mockResolvedValue([]);
    open();
    await screen.findByText("Rahmat Wali");
    fireEvent.click(button("01 Nov 2026")!);
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith(expect.stringContaining("no longer active")));
    expect((button("01 Nov 2026") as HTMLButtonElement).disabled).toBe(false);
  });

  it.each([
    ["salesman", SalesmanAttendanceLog],
    ["order booker", OrderBookerAttendanceLog],
  ])("works the same for a %s, opening on the payroll month", async (_role, Log) => {
    const person = { id: "d1", name: "Field Person", firstName: "Field", lastName: "Person", employeeCode: "1", designation: "Field", joiningDate: "2026-01-01", status: "active", restDays: [5] };
    const field = { ...day("2026-11-01", "present"), deliveryCount: 0, recoveryCount: 0, totalDeliveredAmount: 0, totalRecoveredAmount: 0, deliveries: [], recoveries: [], orderCount: 0, emptyTripCount: 0, orderTripCount: 0, totalFuelCost: 0, totalOrderValue: 0, oldShopVisits: 0, newShopVisits: 0 };
    mocks.log.mockResolvedValue({
      employee: person, orderBooker: { id: "b", name: "Field Person", assignedArea: "Lahore", status: "active" },
      summary: { presentDays: 1, pendingDays: 0, totalDeliveries: 0, totalRecoveries: 0, totalDeliveredAmount: 0, totalRecoveredAmount: 0 },
      totals: { daysPresent: 1, pendingReviewDays: 0, tripCount: 0, orderCount: 0, emptyTripCount: 0, totalDistanceKm: 0, totalFuelCost: 0, totalTadaAmount: 0, totalOrderValue: 0, oldShopVisits: 0, newShopVisits: 0 },
      days: [field], rows: [field], meta: {},
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Suspense fallback="Loading"><Log employeeId="d1" showHeader={false} /></Suspense>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Edit attendance on 01 Nov 2026" }));
    expect(await screen.findByRole("button", { name: "Close 2026-11-01" })).toBeTruthy();
    expect(mocks.log).toHaveBeenCalledWith({ data: { employeeId: "d1", startDate: "2026-10-16", endDate: "2026-11-15" } });
  });
});
