import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManualPunchTimeline } from "./manual-punch-timeline";

const mocks = vi.hoisted(() => ({
  punches: [] as Array<{
    id: string;
    timestamp: string;
    attendanceDate: string;
    direction: "in" | "out";
    source: "qr_terminal" | "manual" | "offline_excel" | "device_import";
    requiresCorrectionReason?: boolean;
    note?: string | null;
    terminalUser?: {
      id: string;
      name: string | null;
      email: string | null;
    } | null;
  }>,
  addManualPunch: vi.fn(),
  deletePunch: vi.fn(),
  correctPunch: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({ data: { attendanceGraceMinutes: 15 } }),
}));
vi.mock("@/server-functions/hr/payroll/settings-fn", () => ({
  getHrPayrollSettingsFn: vi.fn(),
}));

vi.mock("@/hooks/hr/use-attendance-punches", () => ({
  useEmployeePunches: () => ({
    data: mocks.punches,
    isLoading: false,
  }),
  useAddManualPunch: () => ({
    isPending: false,
    mutateAsync: mocks.addManualPunch,
  }),
  useDeletePunch: () => ({
    isPending: false,
    mutateAsync: mocks.deletePunch,
  }),
  useCorrectPunch: () => ({
    isPending: false,
    mutateAsync: mocks.correctPunch,
  }),
}));

function Host() {
  const [summaryEvents, setSummaryEvents] = useState(0);

  return (
    <div>
      <span data-testid="summary-events">{summaryEvents}</span>
      <ManualPunchTimeline
        employeeId="emp-1"
        date="2026-07-03"
        shifts={[{ start: "09:00", end: "17:00" }]}
        onSummaryChange={() => setSummaryEvents((current) => current + 1)}
      />
    </div>
  );
}

describe("manual punch timeline behavior", () => {
  beforeEach(() => {
    mocks.punches = [];
    mocks.addManualPunch.mockReset();
    mocks.deletePunch.mockReset();
    mocks.correctPunch.mockReset();
  });

  it("emits the initial summary once for stable punch data", async () => {
    render(<Host />);

    await waitFor(() => {
      expect(screen.getByTestId("summary-events").textContent).toBe("1");
    });

    await new Promise((resolve) => window.setTimeout(resolve, 25));

    expect(screen.getByTestId("summary-events").textContent).toBe("1");
  });

  it.each([
    ["offline_excel", "Offline Excel"],
    ["device_import", "Device import"],
    ["manual", "Manual"],
  ] as const)(
    "requires reason before correcting a %s punch",
    async (source, label) => {
      mocks.punches = [
        {
          id: "punch-1",
          timestamp: "2026-07-03T04:00:00.000Z",
          attendanceDate: "2026-07-03",
          direction: "in",
          source,
          requiresCorrectionReason: source === "manual",
        },
      ];

      render(<Host />);

      expect(screen.getByText(label)).toBeTruthy();
      fireEvent.click(screen.getByTitle("Correct punch time"));

      const saveButton = screen.getByRole("button", { name: /save/i });
      expect((saveButton as HTMLButtonElement).disabled).toBe(true);

      fireEvent.change(
        screen.getByPlaceholderText(
          "Required, e.g. supervisor verified wrong time.",
        ),
        { target: { value: "verified wrong time" } },
      );
      expect((saveButton as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(saveButton);

      await waitFor(() => {
        expect(mocks.correctPunch).toHaveBeenCalledWith({
          data: expect.objectContaining({
            punchId: "punch-1",
            reason: "verified wrong time",
          }),
        });
      });
    },
  );

  it.each([
    ["offline_excel", "Offline Excel"],
    ["device_import", "Device import"],
    ["manual", "Manual"],
  ] as const)(
    "requires reason before deleting a %s punch",
    async (source, label) => {
      mocks.punches = [
        {
          id: "punch-1",
          timestamp: "2026-07-03T04:00:00.000Z",
          attendanceDate: "2026-07-03",
          direction: "in",
          source,
          requiresCorrectionReason: source === "manual",
        },
      ];

      render(<Host />);

      fireEvent.click(screen.getByTitle(`Delete ${label} punch`));
      expect(screen.getByText(`Delete ${label} punch?`)).toBeTruthy();

      const deleteButton = screen.getByRole("button", { name: "Delete punch" });
      expect((deleteButton as HTMLButtonElement).disabled).toBe(true);

      fireEvent.change(
        screen.getByPlaceholderText(
          "Required, e.g. duplicate verified by supervisor.",
        ),
        { target: { value: "duplicate verified" } },
      );
      expect((deleteButton as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(deleteButton);

      await waitFor(() => {
        expect(mocks.deletePunch).toHaveBeenCalledWith({
          data: {
            punchId: "punch-1",
            reason: "duplicate verified",
          },
        });
      });
    },
  );
});
