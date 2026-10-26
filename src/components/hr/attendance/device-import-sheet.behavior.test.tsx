import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceImportPreview } from "@/lib/attendance/device-import/contracts";
import { DeviceImportSheet } from "./device-import-sheet";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  preview: vi.fn(),
  confirm: vi.fn(),
  list: vi.fn(),
  undo: vi.fn(),
  discard: vi.fn(),
  unlink: vi.fn(),
  daily: vi.fn(),
  editor: vi.fn(),
  permissions: ["hr.manage"],
}));
vi.mock("@/server-functions/hr/attendance/device-import-fn", () => ({
  uploadDeviceAttendanceFn: mocks.upload,
  previewDeviceAttendanceFn: mocks.preview,
  confirmDeviceAttendanceFn: mocks.confirm,
  listDeviceAttendanceImportsFn: mocks.list,
  undoDeviceAttendanceImportFn: mocks.undo,
  discardDeviceAttendanceImportFn: mocks.discard,
  unlinkDevicePersonFn: mocks.unlink,
}));
vi.mock("@/server-functions/hr/attendance/get-daily-attendance-fn", () => ({
  getDailyAttendanceFn: mocks.daily,
}));
vi.mock("@/hooks/use-viewer-access", () => ({
  useViewerAccess: () => ({ data: { permissions: mocks.permissions } }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, params, search, to, ...props }: Record<string, any>) => (
    <a
      href={`${to.replace("$employeeId", params.employeeId)}?from=${search.from}&to=${search.to}`}
      {...props}
    >
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/components/custom/responsive-sheet", () => ({
  ResponsiveSheet: ({
    open,
    title,
    children,
  }: {
    open: boolean;
    title: string;
    children: ReactNode;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}));
vi.mock("./edit-attendance-sheet", () => ({
  EditAttendanceSheet: (props: { onOpenChange: (open: boolean) => void }) => {
    mocks.editor(props);
    return (
      <div role="dialog" aria-label="Attendance Management">
        <button onClick={() => props.onOpenChange(false)}>Close editor</button>
      </div>
    );
  },
}));

const report: DeviceImportPreview = {
  importId: "import-1",
  filename: "device.csv",
  format: "csv",
  status: "preview",
  employees: [
    { id: "employee-1", employeeCode: "EMP01", name: "Ali Khan" },
    { id: "employee-2", employeeCode: "EMP02", name: "Sara Ahmed" },
  ],
  rows: [
    {
      rowNumber: 3,
      personId: "EMP01",
      personName: "Ali",
      employeeId: "employee-1",
      employeeName: "Ali Khan",
      date: "2026-10-01",
      punchTimes: ["09:00", "17:00"],
      status: "ready",
      messages: [],
      newPunchCount: 2,
      dutyHours: "8.00",
    },
    {
      rowNumber: 4,
      personId: "EMP01",
      personName: "Ali",
      employeeId: "employee-1",
      employeeName: "Ali Khan",
      date: "2026-10-02",
      punchTimes: ["09:00"],
      status: "needs_review",
      messages: [
        "Missing checkout. HR must correct this attendance day before payroll.",
      ],
      newPunchCount: 1,
      dutyHours: "0.00",
    },
    {
      rowNumber: 5,
      personId: "99",
      personName: "Sara",
      employeeId: null,
      employeeName: null,
      date: "2026-10-01",
      punchTimes: ["09:00", "17:00"],
      status: "needs_review",
      messages: ["Link this device Person ID to an employee before importing."],
      newPunchCount: 0,
      dutyHours: null,
    },
    {
      rowNumber: 6,
      personId: "EMP01",
      personName: "Ali",
      employeeId: "employee-1",
      employeeName: "Ali Khan",
      date: "2026-09-30",
      punchTimes: ["09:00"],
      status: "blocked",
      messages: ["Approved payroll is locked."],
      newPunchCount: 0,
      dutyHours: null,
    },
  ],
};

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <DeviceImportSheet open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

async function uploadReport() {
  fireEvent.change(screen.getByLabelText("Device report"), {
    target: { files: [new File(["report"], "device.csv")] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Upload and preview" }));
  await screen.findByRole("region", { name: "Report preview" });
}

describe("device import sheet behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.permissions = ["hr.manage"];
    mocks.upload.mockResolvedValue(structuredClone(report));
    mocks.preview.mockResolvedValue(structuredClone(report));
    mocks.confirm.mockResolvedValue({
      ...structuredClone(report),
      status: "completed",
    });
    mocks.list.mockResolvedValue([]);
    mocks.daily.mockResolvedValue([]);
    window.HTMLElement.prototype.scrollIntoView = vi.fn();
    window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
    window.HTMLElement.prototype.releasePointerCapture = vi.fn();
  });

  it("warns when the report leaves payroll month dates uncovered", async () => {
    mocks.upload.mockResolvedValue({
      ...structuredClone(report),
      cycleGaps: [
        {
          label: "October 2026",
          range: "Sep 16 – Oct 15, 2026",
          startDate: "2026-09-16",
          endDate: "2026-10-15",
          missingRanges: [
            { start: "2026-09-16", end: "2026-09-29" },
            { start: "2026-10-15", end: "2026-10-15" },
          ],
          missingDayCount: 15,
        },
      ],
    });
    setup();
    await uploadReport();
    expect(
      screen.getByText("October 2026 payroll month is incomplete"),
    ).toBeTruthy();
    expect(
      screen.getByText(/No attendance is recorded for 15 days: Sep 16 – Sep 29, Oct 15\./),
    ).toBeTruthy();
  });

  it("uploads the selected file, displays exceptions and imports historical open punches", async () => {
    mocks.preview.mockResolvedValue({
      ...structuredClone(report),
      status: "completed",
      rows: report.rows.map((row) => ({ ...row, newPunchCount: 0 })),
    });
    setup();
    await uploadReport();
    expect(mocks.upload.mock.calls[0][0].data.get("file").name).toBe(
      "device.csv",
    );
    expect(screen.getByText("2026-09-30 to 2026-10-02")).toBeTruthy();
    expect(screen.getByText("Approved payroll is locked.")).toBeTruthy();
    expect(
      screen.getByText(
        "Missing checkout. HR must correct this attendance day before payroll.",
      ),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Review attendance row 5",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(
      screen.getByRole("button", { name: "Import 3 new punches" }),
    );
    await waitFor(() =>
      expect(mocks.confirm).toHaveBeenCalledWith({
        data: { importId: "import-1", mappings: {} },
      }),
    );
    expect(await screen.findByText("Import completed")).toBeTruthy();
    expect(await screen.findByText("Import saved")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Import 0 new punches",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("requires a refreshed preview after changing an unknown Person ID mapping", async () => {
    setup();
    await uploadReport();
    fireEvent.keyDown(
      screen.getByRole("combobox", { name: "Person ID 99, Sara" }),
      { key: "ArrowDown" },
    );
    fireEvent.click(
      await screen.findByRole("option", { name: "EMP02 · Sara Ahmed" }),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Import 3 new punches",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    const mapped = structuredClone(report);
    mapped.rows[2] = {
      ...mapped.rows[2],
      employeeId: "employee-2",
      employeeName: "Sara Ahmed",
      status: "ready",
      newPunchCount: 2,
      messages: [],
    };
    mocks.preview.mockResolvedValue(mapped);
    fireEvent.click(screen.getByRole("button", { name: "Refresh preview" }));
    await waitFor(() =>
      expect(mocks.preview).toHaveBeenCalledWith({
        data: { importId: "import-1", mappings: { "99": "employee-2" } },
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Import 5 new punches" }),
    );
    await waitFor(() =>
      expect(mocks.confirm).toHaveBeenCalledWith({
        data: { importId: "import-1", mappings: { "99": "employee-2" } },
      }),
    );
  });

  it("opens the original attendance date for a next-morning overnight checkout", async () => {
    const overnight = structuredClone(report);
    overnight.rows = [
      {
        ...overnight.rows[0],
        date: "2026-10-02",
        punchTimes: ["06:00"],
        attendanceDates: ["2026-10-01"],
      },
    ];
    mocks.upload.mockResolvedValue(overnight);
    setup();
    await uploadReport();
    fireEvent.click(
      screen.getByRole("button", { name: "Review attendance row 3" }),
    );
    await waitFor(() =>
      expect(mocks.daily).toHaveBeenCalledWith({
        data: { date: "2026-10-01" },
      }),
    );
  });

  it("loads the full employee day into the existing editor and refreshes on return", async () => {
    const employee = {
      id: "employee-1",
      firstName: "Ali",
      lastName: "Khan",
      isOrderBooker: false,
      shifts: [{ start: "09:00", end: "17:00" }],
      restDays: [0],
      attendance: [
        {
          status: "present",
          entrySource: "biometric",
          notes: "Existing HR note",
          dutyHours: "0.00",
        },
      ],
    };
    mocks.daily.mockResolvedValue([employee]);
    setup();
    await uploadReport();
    fireEvent.click(
      screen.getByRole("button", { name: "Review attendance row 4" }),
    );
    await screen.findByRole("dialog", { name: "Attendance Management" });
    expect(mocks.daily).toHaveBeenCalledWith({ data: { date: "2026-10-02" } });
    expect(mocks.editor).toHaveBeenLastCalledWith(
      expect.objectContaining({
        employee,
        attendance: employee.attendance[0],
        date: "2026-10-02",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
    await waitFor(() => expect(mocks.preview).toHaveBeenCalled());
    expect(
      screen.getByRole("dialog", { name: "Device attendance import" }),
    ).toBeTruthy();
  });

  it("reopens completed uploads for follow-up review and retry", async () => {
    mocks.list.mockResolvedValue([
      {
        id: "import-1",
        filename: "earlier.xlsx",
        createdAt: "2026-10-02T12:00:00Z",
        status: "completed",
        totalRows: 4,
        reviewRows: 2,
      },
    ]);
    mocks.preview.mockResolvedValue({
      ...structuredClone(report),
      status: "completed",
    });
    setup();
    fireEvent.click(
      await screen.findByRole("button", { name: "Open upload earlier.xlsx" }),
    );
    expect(await screen.findByText("Import completed")).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Import 3 new punches",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("shows upload errors and disables actions while a request is pending", async () => {
    let reject!: (error: Error) => void;
    mocks.upload.mockImplementation(
      () =>
        new Promise((_resolve, fail) => {
          reject = fail;
        }),
    );
    setup();
    fireEvent.change(screen.getByLabelText("Device report"), {
      target: { files: [new File(["report"], "device.csv")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload and preview" }));
    const pending = await screen.findByRole("button", {
      name: /Uploading report/,
    });
    expect((pending as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByLabelText("Device report") as HTMLInputElement).disabled,
    ).toBe(true);
    reject(new Error("Invalid device report headers"));
    expect(
      await screen.findByText("Invalid device report headers"),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Upload and preview",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });

  it("validates file selection and hides upload actions without HR management access", async () => {
    const view = setup();
    fireEvent.change(screen.getByLabelText("Device report"), {
      target: { files: [new File(["report"], "device.pdf")] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Upload and preview" }));
    expect(
      await screen.findByText("Choose a CSV or Excel report up to 10 MB."),
    ).toBeTruthy();
    expect(mocks.upload).not.toHaveBeenCalled();
    view.unmount();
    mocks.permissions = ["hr.view"];
    mocks.list.mockClear();
    setup();
    expect(screen.getByText("HR management access required")).toBeTruthy();
    expect(screen.queryByLabelText("Device report")).toBeNull();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it("highlights rows needing attention and filters the preview", async () => {
    setup();
    await uploadReport();
    const reviewRow = screen
      .getByRole("button", { name: "Review attendance row 4" })
      .closest("tr")!;
    expect(reviewRow.getAttribute("data-status")).toBe("needs_review");
    expect(reviewRow.className).toContain("bg-amber-500/10");

    fireEvent.click(
      screen.getByRole("button", { name: "Show only rows needing attention" }),
    );
    expect(screen.getByText("Showing 3 of 4 rows")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Review attendance row 3" }),
    ).toBeNull();

    fireEvent.change(screen.getByLabelText("Search rows"), {
      target: { value: "sara" },
    });
    expect(screen.getByText("Showing 1 of 4 rows")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Review attendance row 5" }),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Search rows"), {
      target: { value: "nobody" },
    });
    expect(screen.getByText("No rows match these filters.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(
      screen
        .getAllByRole("link", { name: "Open Ali Khan's month" })
        [0].getAttribute("href"),
    ).toBe("/hr/attendance/employee-1?from=2026-10-01&to=2026-10-31");

    expect(
      screen.getByRole("button", { name: "Review attendance row 3" }),
    ).toBeTruthy();
  });

  it("undoes a completed import after confirmation and blocks re-import", async () => {
    mocks.preview
      .mockResolvedValueOnce({ ...structuredClone(report), status: "completed" })
      .mockResolvedValue({ ...structuredClone(report), status: "undone" });
    mocks.list.mockResolvedValue([
      {
        id: "import-1",
        filename: "wrong.xlsx",
        createdAt: "2026-10-02T12:00:00Z",
        status: "completed",
        totalRows: 4,
        reviewRows: 2,
      },
    ]);
    mocks.undo.mockResolvedValue({ removedPunchCount: 3, keptPunchCount: 0 });
    setup();
    fireEvent.click(
      await screen.findByRole("button", { name: "Open upload wrong.xlsx" }),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Undo import" }));
    expect(await screen.findByText("Undo this import?")).toBeTruthy();
    expect(mocks.undo).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Undo import",
      }),
    );
    await waitFor(() =>
      expect(mocks.undo).toHaveBeenCalledWith({
        data: { importId: "import-1" },
      }),
    );
    expect(
      await screen.findByText(/Punches from this import were removed/),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "Import 3 new punches",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Undo import" })).toBeNull();
  });

  it("discards an unimported upload", async () => {
    mocks.discard.mockResolvedValue(undefined);
    setup();
    await uploadReport();
    expect(screen.queryByRole("button", { name: "Undo import" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Discard upload" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "Discard upload",
      }),
    );
    await waitFor(() =>
      expect(mocks.discard).toHaveBeenCalledWith({
        data: { importId: "import-1" },
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Report preview" })).toBeNull(),
    );
  });

  it("warns about a duplicate file and unlinks a saved Person ID", async () => {
    mocks.upload.mockResolvedValue({
      ...structuredClone(report),
      savedLinks: [{ personId: "EMP01", employeeId: "employee-1" }],
      duplicateOf: {
        filename: "device-old.csv",
        createdAt: "2026-10-01T12:00:00Z",
        status: "completed",
      },
    });
    mocks.unlink.mockResolvedValue(undefined);
    setup();
    await uploadReport();
    expect(screen.getByText("This file was already imported")).toBeTruthy();
    expect(screen.getByText(/device-old\.csv/)).toBeTruthy();
    expect(screen.getByText(/Person ID EMP01 · EMP01 · Ali Khan/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Unlink Person ID EMP01" }),
    );
    await waitFor(() =>
      expect(mocks.unlink).toHaveBeenCalledWith({
        data: { personId: "EMP01" },
      }),
    );
    await waitFor(() =>
      expect(mocks.preview).toHaveBeenCalledWith({
        data: { importId: "import-1", mappings: {} },
      }),
    );
    expect(
      await screen.findByRole("combobox", { name: "Person ID EMP01, Ali" }),
    ).toBeTruthy();
  });
});
