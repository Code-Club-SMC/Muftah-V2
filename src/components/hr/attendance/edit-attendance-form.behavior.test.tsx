import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { EditAttendanceForm } from "./edit-attendance-form";

const mutateAsync = vi.fn();

const summary10Hours = {
  checkIn: "09:00:00",
  checkOut: "19:00:00",
  dutyHours: "10.00",
  isLate: false,
  isNightShift: false,
  earlyDepartureStatus: "none" as const,
  openInCount: 0,
  shiftViolations: [],
};

const summary11Hours = {
  ...summary10Hours,
  checkOut: "20:00:00",
  dutyHours: "11.00",
};

const summary9Hours = {
  ...summary10Hours,
  checkOut: "18:00:00",
  dutyHours: "9.00",
};

vi.mock("@/hooks/hr/use-upsert-attendance", () => ({
  useUpsertAttendance: () => ({
    mutateAsync,
    isPending: false,
  }),
  useClearOrderBookerManualOverride: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock("./manual-punch-timeline", () => ({
  ManualPunchTimeline: ({
    onSummaryChange,
  }: {
    onSummaryChange?: (
      summary: typeof summary10Hours,
      punchCount: number,
      isLoaded: boolean,
    ) => void;
  }) => {
    return (
      <div>
        <button
          type="button"
          onClick={() => onSummaryChange?.(summary10Hours, 2, true)}
        >
          Emit 10h Summary
        </button>
        <button
          type="button"
          onClick={() => onSummaryChange?.(summary9Hours, 2, true)}
        >
          Emit 9h Summary
        </button>
        <button
          type="button"
          onClick={() => onSummaryChange?.(summary11Hours, 2, true)}
        >
          Emit 11h Summary
        </button>
      </div>
    );
  },
}));

function renderForm() {
  return render(
    <EditAttendanceForm
      employee={{
        id: "emp-1",
        firstName: "Jasmine",
        lastName: "Rehman",
        standardDutyHours: 8,
        isOrderBooker: false,
        shifts: [{ start: "09:00", end: "17:00" }],
      }}
      attendance={{
        status: "present",
        dutyHours: "0.00",
        overtimeHours: "0.00",
        overtimeStatus: "pending",
        overtimeRemarks: null,
        isLate: false,
        isNightShift: false,
        leaveApprovalStatus: "none",
        earlyDepartureStatus: "none",
      }}
      date="2026-07-04"
      onSuccess={() => {}}
    />,
  );
}

describe("edit attendance form overtime behavior", () => {
  beforeEach(() => {
    mutateAsync.mockReset();
  });

  it("shows suggested OT and prefills the request only once", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Emit 10h Summary" }));

    await waitFor(() => {
      expect(screen.getByText("Suggested OT")).toBeTruthy();
      expect(screen.getByDisplayValue("2.00")).toBeTruthy();
    });

    const overtimeInput = screen.getByRole("spinbutton");
    fireEvent.change(overtimeInput, { target: { value: "1.50" } });

    fireEvent.click(screen.getByRole("button", { name: "Emit 11h Summary" }));

    await waitFor(() => {
      expect(screen.getByText("3.00h")).toBeTruthy();
      expect(
        (screen.getByRole("spinbutton") as HTMLInputElement).value,
      ).toBe("1.50");
    });
  });

  it("requires a reason for OT, clears it at zero, and never calls save without it", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Emit 10h Summary" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("2.00")).toBeTruthy();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Save Attendance Record" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          "Overtime reason is required when overtime hours are greater than 0",
        ),
      ).toBeTruthy();
    });
    expect(mutateAsync).not.toHaveBeenCalled();

    const remarks = screen.getByPlaceholderText(
      "Describe why overtime was necessary...",
    );
    fireEvent.change(remarks, { target: { value: "Urgent dispatch load" } });

    const overtimeInput = screen.getByRole("spinbutton");
    fireEvent.change(overtimeInput, { target: { value: "0" } });

    await waitFor(() => {
      expect(
        screen.queryByPlaceholderText("Describe why overtime was necessary..."),
      ).toBeNull();
    });

    fireEvent.change(overtimeInput, { target: { value: "1" } });

    await waitFor(() => {
      expect(
        (
          screen.getByPlaceholderText(
            "Describe why overtime was necessary...",
          ) as HTMLTextAreaElement
        ).value,
      ).toBe("");
    });
  });

  it("shows a stale warning and blocks save when requested OT is above the latest suggestion", async () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Emit 10h Summary" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue("2.00")).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Emit 9h Summary" }));

    await waitFor(() => {
      expect(
        screen.getAllByText(
          "Requested OT cannot be more than the suggested OT.",
        ).length,
      ).toBeGreaterThan(0);
      expect(
        (
          screen.getByRole("button", {
            name: "Fix Requested OT Before Saving",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    });
  });
});
