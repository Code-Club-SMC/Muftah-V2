import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import type { ReactNode } from "react";

const mutation = vi.hoisted(() => vi.fn(async () => ({ message: "Saved", leaveApprovalStatus: "approved", overtimeStatus: "approved" })));
vi.mock("@/server-functions/hr/attendance/upsert-attendance-fn", () => ({ upsertAttendanceFn: mutation }));
vi.mock("@/server-functions/hr/attendance/clear-order-booker-manual-override-fn", () => ({ clearOrderBookerManualOverrideFn: mutation }));
vi.mock("@/server-functions/hr/attendance/leave-approvals-fn", () => ({ processLeaveApprovalFn: mutation }));
vi.mock("@/server-functions/hr/attendance/process-overtime-fn", () => ({ processOvertimeFn: mutation }));
vi.mock("@/server-functions/hr/attendance/convert-overtime-fn", () => ({ convertOvertimeToCompOffFn: mutation }));
vi.mock("@/server-functions/hr/attendance/bulk-mark-attendance-range-fn", () => ({ bulkMarkAttendanceRangeFn: mutation, previewBulkAttendanceFn: mutation }));
vi.mock("@/server-functions/hr/attendance/time-exceptions-fn", () => ({ decideTimeExceptionsFn: mutation, getTimeExceptionsFn: mutation }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import { useUpsertAttendance } from "./use-upsert-attendance";
import { useProcessLeaveApproval } from "./use-process-leave-approval";
import { useProcessOvertime } from "./use-process-overtime";
import { useConvertOvertimeToCompOff } from "./use-convert-overtime";
import { useBulkMarkAttendance } from "./use-bulk-mark-attendance";
import { useDecideTimeExceptions } from "./use-time-exceptions";

const keys = [
  ["payroll-dashboard", "2026-10", 0],
  ["payslip-preview", "employee", "2026-10", [], {}],
  ["employee-payroll-history", "employee", "last12"],
];
it.each(["attendance", "leave", "overtime", "conversion", "bulk", "lateEarly"] as const)("invalidates cached salary data after %s changes", async name => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity }, mutations: { retry: false } } });
  for (const key of keys) client.setQueryData(key, { netSalary: 42900 });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const { result, unmount } = renderHook(() => ({
    attendance: useUpsertAttendance(), leave: useProcessLeaveApproval(), overtime: useProcessOvertime(),
    conversion: useConvertOvertimeToCompOff(), bulk: useBulkMarkAttendance(), lateEarly: useDecideTimeExceptions(),
  }), { wrapper });
  try {
    await act(async () => {
      await (result.current[name] as unknown as { mutateAsync(value: unknown): Promise<unknown> }).mutateAsync({ id: "row", status: "approved", employeeId: "employee", attendanceIds: ["row"], data: {} });
    });
    for (const key of keys) expect(client.getQueryState(key)?.isInvalidated, `${name}: ${key[0]}`).toBe(true);
  } finally { unmount(); client.clear(); }
});
