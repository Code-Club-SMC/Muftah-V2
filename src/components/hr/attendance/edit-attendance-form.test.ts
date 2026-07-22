import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync(
  "src/components/hr/attendance/edit-attendance-form.tsx",
  "utf8",
);

describe("edit attendance form source", () => {
  it("explains that standard staff punches drive attendance", () => {
    expect(source).toContain("Punches control standard staff attendance");
    expect(source).toContain("Calculated from punches");
    expect(source).toContain(
      "Use Save only for notes, overtime, or early-leave",
    );
  });

  it("shows the suggested-vs-requested overtime workflow clearly", () => {
    expect(source).toContain("Overtime request summary");
    expect(source).toContain("Requested OT Hours");
    expect(source).toContain(
      "Suggested OT is based on punches and standard duty hours.",
    );
    expect(source).toContain(
      "Requested OT cannot be more than the suggested OT.",
    );
    expect(source).toContain(
      "Explain why extra hours were needed. Admin will review this before approval.",
    );
  });

  it("keeps early leave review disabled until punches actually show an early checkout", () => {
    expect(source).toContain(
      "No early checkout is detected from the current punches.",
    );
    expect(source).toContain(
      "The last OUT punch is earlier than the scheduled shift end.",
    );
    expect(source).toContain("punchSummary?.earlyDepartureStatus");
  });

  it("explains the early leave payroll fallback clearly", () => {
    expect(source).toContain(
      "payroll",
    );
    expect(source).toContain(
      "still treats it as a short day and falls back to the normal",
    );
    expect(source).toContain(
      "short-hours deduction rule.",
    );
  });

  it("supports order-booker manual override and trip-driven reset UX", () => {
    expect(source).toContain("useClearOrderBookerManualOverride");
    expect(source).toContain("isTripDrivenOrderBookerDay");
    expect(source).toContain("disabledByTrip");
    expect(source).toContain("This day has trip records, so it stays Present");
    expect(source).toContain(
      "A remark is required when manually resolving an order-booker day.",
    );
    expect(source).toContain("Return to Trip-Driven Status");
    expect(source).toContain("Manual order-booker decisions need a remark");
  });
});
