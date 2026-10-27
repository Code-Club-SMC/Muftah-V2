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
    expect(source).toContain("Use Save only for notes or overtime.");
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

  it("replaces the early leave select with late/early decisions", () => {
    expect(source).toContain("Late / Early Review");
    expect(source).toContain("Pay is cut only for items marked Rejected.");
    expect(source).toContain("<TimeExceptionDecisions attendanceId={attendance?.id} />");
    expect(source).not.toContain('aria-label="Early departure status"');
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
