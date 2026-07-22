import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ManualPunchTimeline } from "./manual-punch-timeline";

vi.mock("@/hooks/hr/use-attendance-punches", () => ({
  useEmployeePunches: () => ({
    data: [],
    isLoading: false,
  }),
  useAddManualPunch: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useDeletePunch: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
  }),
  useCorrectPunch: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
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
  it("emits the initial summary once for stable punch data", async () => {
    render(<Host />);

    await waitFor(() => {
      expect(screen.getByTestId("summary-events").textContent).toBe("1");
    });

    await new Promise((resolve) => window.setTimeout(resolve, 25));

    expect(screen.getByTestId("summary-events").textContent).toBe("1");
  });
});
