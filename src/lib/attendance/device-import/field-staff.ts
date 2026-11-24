import { toPKTDate } from "../time";
import type { DeviceImportRowStatus, DevicePunchReportRow } from "./contracts";

// Order bookers, salesmen and drivers have no punch timeline. A punch only proves the day was
// worked, so the day is marked present and the times are not saved.
export const isFieldStaff = (employee: {
  isOrderBooker?: boolean | null;
  isSalesman?: boolean | null;
  isDriver?: boolean | null;
}) =>
  Boolean(employee.isOrderBooker || employee.isSalesman || employee.isDriver);

export type FieldStaffPlannedRow = {
  row: DevicePunchReportRow;
  status: DeviceImportRowStatus;
  messages: string[];
  marksPresent: boolean;
};

export function planFieldStaffRows(input: {
  rows: DevicePunchReportRow[];
  attendanceRows: { date: string; status: string }[];
  lockedDates: Set<string>;
  joiningDate: string;
  now: Date;
}): FieldStaffPlannedRow[] {
  const statuses = new Map(
    input.attendanceRows.map((row) => [row.date, row.status]),
  );
  const today = toPKTDate(input.now);
  return input.rows.map((row) => {
    const plan = (
      status: DeviceImportRowStatus,
      message: string,
      marksPresent = false,
    ): FieldStaffPlannedRow => ({
      row,
      status,
      messages: [...row.issues, message],
      marksPresent,
    });
    if (!row.date)
      return plan("needs_review", "This row has no valid date.");
    const { date } = row;
    const saved = statuses.get(date);
    // One valid punch is enough, so times that are out of order or miscounted do not matter.
    const punched =
      date <= today &&
      row.punches.some(
        (time) =>
          new Date(`${date}T${time}:00+05:00`).getTime() <=
          input.now.getTime(),
      );
    if (!punched) {
      if (saved) return plan("unchanged", `This day is already ${saved}.`);
      return plan(
        "needs_review",
        row.punches.length
          ? "Future punches require HR review."
          : "No punches recorded. HR must resolve this day's attendance status.",
      );
    }
    if (date < input.joiningDate)
      return plan(
        "needs_review",
        "This date is before the employee's joining date.",
      );
    if (saved === "present")
      return plan("unchanged", "This day is already present.");
    if (input.lockedDates.has(date))
      return plan(
        "blocked",
        "This attendance date belongs to approved or paid payroll.",
      );
    if (saved)
      return plan(
        "blocked",
        `HR marked this day ${saved}, but the device has ${row.punches.length === 1 ? "a punch" : `${row.punches.length} punches`}. HR's decision is kept. If they worked, use Review day to change it to Present.`,
      );
    statuses.set(date, "present");
    return plan(
      "ready",
      "Field staff: any punch marks the day present.",
      true,
    );
  });
}
