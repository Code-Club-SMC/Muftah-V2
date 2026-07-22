import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CREATE_EMPLOYEE_SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "src/server-functions/hr/employees/create-employee-fn.ts",
  ),
  "utf8",
);
const UPDATE_EMPLOYEE_SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "src/server-functions/hr/employees/update-employee-fn.ts",
  ),
  "utf8",
);
const ATTENDANCE_LOG_SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "src/components/hr/attendance/employee-attendance-log.tsx",
  ),
  "utf8",
);
const ATTENDANCE_LIST_SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "src/components/hr/attendance/attendance-list-table.tsx",
  ),
  "utf8",
);
const EDIT_ATTENDANCE_SOURCE = readFileSync(
  resolve(
    process.cwd(),
    "src/components/hr/attendance/edit-attendance-form.tsx",
  ),
  "utf8",
);

describe("hr shift timing support", () => {
  it("persists shift timings through employee create and update", () => {
    expect(CREATE_EMPLOYEE_SOURCE).toContain("shifts: (data.shifts ?? []).filter");
    expect(UPDATE_EMPLOYEE_SOURCE).toContain("shifts: (updateData.shifts ?? []).filter");
  });

  it("keeps early departure state in the attendance edit form", () => {
    expect(EDIT_ATTENDANCE_SOURCE).toContain("earlyDepartureStatus");
    expect(EDIT_ATTENDANCE_SOURCE).toContain(
      "shifts={employee.shifts ?? null}",
    );
  });

  it("separates scheduled shift from actual punch span in the attendance log", () => {
    expect(ATTENDANCE_LOG_SOURCE).toContain('header: "Shift Window"');
    expect(ATTENDANCE_LOG_SOURCE).toContain('header: "Punch Timeline"');
  });

  it("uses clear shift wording in the daily attendance ledger", () => {
    expect(ATTENDANCE_LIST_SOURCE).toContain('header: "Shift Window"');
    expect(ATTENDANCE_LIST_SOURCE).toContain('header: "First Punch In"');
    expect(ATTENDANCE_LIST_SOURCE).toContain('header: "Last Punch Out"');
  });
});
