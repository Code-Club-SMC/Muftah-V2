import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ apply: vi.fn(), preview: vi.fn(), undo: vi.fn(), previewUndo: vi.fn(), employees: vi.fn() }));
vi.mock("@/server-functions/hr/attendance/bulk-mark-attendance-range-fn", () => ({ bulkMarkAttendanceRangeFn: mock.apply, previewBulkAttendanceFn: mock.preview, undoBulkPresentFn: mock.undo, previewUndoBulkPresentFn: mock.previewUndo }));
vi.mock("@/server-functions/hr/employees/get-employees-fn", () => ({ getEmployeesFn: mock.employees }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/custom/responsive-sheet", () => ({ ResponsiveSheet: ({ open, children }: { open: boolean; children: ReactNode }) => (open ? <div>{children}</div> : null) }));
import { toast } from "sonner";
import { BulkAttendanceSheet } from "./bulk-attendance-sheet";

const counts = { totalEmployees: 2, affectedEmployees: 1, willCreate: 3, willUpdate: 0, skippedRestDays: 1, skippedExisting: 0, skippedPunchDays: 2, skippedMissingShift: 0, skippedFuture: 0, skippedNotJoined: 0, skippedHolidays: 0, noteNeeded: false, blockedReason: null };
const onOpenChange = vi.fn();
const show = (startDate = "2026-10-12", endDate = "2026-10-15") =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BulkAttendanceSheet open onOpenChange={onOpenChange} initialStartDate={startDate} initialEndDate={endDate} />
    </QueryClientProvider>,
  );
const applyButton = () => screen.getByRole("button", { name: /Apply Bulk Mark/ }) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  mock.employees.mockResolvedValue([{ id: "a", firstName: "Aslam", lastName: "Khan", employeeCode: "1", designation: "Operator", restDays: [5] }, { id: "b", firstName: "Bilal", lastName: "Shah", employeeCode: "2", designation: "Driver", isDriver: true, restDays: [5] }]);
  mock.preview.mockResolvedValue(counts);
  mock.apply.mockResolvedValue({ message: "3 days added" });
});
afterEach(cleanup);

it("saves the previewed choice once confirmed, then closes", async () => {
  show();
  await waitFor(() => expect(applyButton().disabled).toBe(false));
  fireEvent.click(applyButton());
  expect(mock.apply).not.toHaveBeenCalled();
  expect(screen.getByText("1 of 2")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm & Apply" }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(mock.apply).toHaveBeenCalledTimes(1);
  expect(mock.apply).toHaveBeenCalledWith({ data: { employeeIds: [], startDate: "2026-10-12", endDate: "2026-10-15", conflictStrategy: "skip", template: { status: "present", leaveType: null, notes: null } } });
});

it("keeps the sheet open with the choices when saving fails", async () => {
  mock.apply.mockRejectedValue(new Error("Attendance belongs to approved or paid payroll."));
  show();
  await waitFor(() => expect(applyButton().disabled).toBe(false));
  fireEvent.click(applyButton());
  fireEvent.click(screen.getByRole("button", { name: "Confirm & Apply" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Attendance belongs to approved or paid payroll."));
  await waitFor(() => expect(screen.queryByText("Confirm Bulk Mark")).toBeNull());
  expect(onOpenChange).not.toHaveBeenCalled();
});

it("asks for a note before field staff can be saved, without reloading the preview per letter", async () => {
  mock.preview.mockResolvedValue({ ...counts, noteNeeded: true });
  show();
  expect(await screen.findByText(/A note is required for/)).toBeTruthy();
  expect(applyButton().disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "  Route confirmed " } });
  expect(applyButton().disabled).toBe(false);
  expect(mock.preview).toHaveBeenCalledTimes(1);
  fireEvent.click(applyButton());
  fireEvent.click(screen.getByRole("button", { name: "Confirm & Apply" }));
  await waitFor(() => expect(mock.apply.mock.calls[0][0].data.template.notes).toBe("Route confirmed"));
});

it("explains a locked payroll and blocks saving", async () => {
  mock.preview.mockResolvedValue({ ...counts, blockedReason: "Attendance belongs to approved or paid payroll." });
  show();
  expect(await screen.findByText(/approved or paid payroll/)).toBeTruthy();
  expect(applyButton().disabled).toBe(true);
});

it("says when the preview failed instead of leaving a dead button", async () => {
  mock.preview.mockRejectedValue(new Error("network"));
  show();
  expect(await screen.findByText(/preview could not be loaded/)).toBeTruthy();
  expect(applyButton().disabled).toBe(true);
});

it.each([["2026-10-15", "2026-10-12", /on or after the start date/], ["2026-01-01", "2026-12-31", /at most 92 days/]])("refuses the range %s to %s", async (start, end, message) => {
  show(start, end);
  expect(await screen.findByText(message)).toBeTruthy();
  expect(mock.preview).not.toHaveBeenCalled();
  expect(applyButton().disabled).toBe(true);
});

it("waits for a leave type before previewing leave", async () => {
  show();
  await waitFor(() => expect(mock.preview).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "On Leave" }));
  expect(applyButton().disabled).toBe(true);
  expect(mock.preview).toHaveBeenCalledTimes(1);
});

it("marks only the people picked", async () => {
  show();
  await screen.findByText("2 employees");
  fireEvent.click(screen.getByRole("checkbox"));
  expect(applyButton().disabled).toBe(true);
  fireEvent.click(screen.getByText("Bilal Shah"));
  await waitFor(() => expect(mock.preview.mock.calls.at(-1)![0].data.employeeIds).toEqual(["b"]));
  expect(screen.getByText(/Driver · Field staff/)).toBeTruthy();
});

const undoCounts = { totalEmployees: 2, affectedEmployees: 2, willClear: 7, keptEdited: 1, blockedReason: null };
const openUndo = () => fireEvent.click(screen.getAllByRole("button", { name: "Undo Present" })[0]);
const undoButton = () => screen.getAllByRole("button", { name: "Undo Present" }).at(-1) as HTMLButtonElement;

it("undoes a bulk present without ever calling the mark action", async () => {
  mock.previewUndo.mockResolvedValue(undoCounts);
  mock.undo.mockResolvedValue({ message: "7 days unmarked." });
  show();
  openUndo();
  await waitFor(() => expect(undoButton().disabled).toBe(false));
  expect(screen.queryByLabelText("Notes")).toBeNull();
  expect(screen.queryByText("Overwrite All")).toBeNull();
  fireEvent.click(undoButton());
  expect(screen.getByText(/7 days for 2 people will become unmarked/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirm & Apply" }));
  await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  expect(mock.undo).toHaveBeenCalledWith({ data: { employeeIds: [], startDate: "2026-10-12", endDate: "2026-10-15" } });
  expect(mock.apply).not.toHaveBeenCalled();
});

it("has nothing to undo, or is blocked by payroll", async () => {
  mock.previewUndo.mockResolvedValue({ ...undoCounts, willClear: 0 });
  show();
  openUndo();
  expect(await screen.findByText("Nothing to apply.")).toBeTruthy();
  expect(undoButton().disabled).toBe(true);
  cleanup();
  mock.previewUndo.mockResolvedValue({ ...undoCounts, blockedReason: "Attendance belongs to approved or paid payroll." });
  show();
  openUndo();
  expect(await screen.findByText(/approved or paid payroll/)).toBeTruthy();
  expect(undoButton().disabled).toBe(true);
});

it("goes back to marking, not undoing, when a status is chosen again", async () => {
  mock.previewUndo.mockResolvedValue(undoCounts);
  show();
  openUndo();
  await waitFor(() => expect(undoButton().disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Absent" }));
  await waitFor(() => expect(applyButton().disabled).toBe(false));
  fireEvent.click(applyButton());
  fireEvent.click(screen.getByRole("button", { name: "Confirm & Apply" }));
  await waitFor(() => expect(mock.apply.mock.calls[0][0].data.template.status).toBe("absent"));
  expect(mock.undo).not.toHaveBeenCalled();
});
