// Independent acceptance oracle. Do not import production payroll/calendar code.
import Big from "big.js";

export const CYCLE = {
  month: "2026-10", storedMonth: "2026-10-01",
  start: "2026-09-16", end: "2026-10-15", timezone: "Asia/Karachi",
  divisor: 26, dutyHours: 8, basic: 26000, gross: 42900, hourly: 125,
} as const;
export const SOURCE = {
  path: "docs/Total Punches(20261001-20261014).csv",
  sha256: "5c96e6912b261a4def094be00b46de516930b6fe085c1cdb75b71684d8779591",
  rows: 52, punches: 138, reviewRows: 12,
} as const;
export const WORKING_DATES = [
  "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19",
  "2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24", "2026-09-25", "2026-09-26",
  "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03",
  "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10",
  "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15",
] as const;
export const BASIC_POLICY = {
  absent: true, annualLeave: false, sickLeave: false, specialLeave: false,
  lateArrival: true, earlyLeaving: true, notEmployed: true,
};
export const ALLOWANCES = [
  ["houseRent", "House Rent", 5200, true, false, false, true],
  ["utilities", "Utilities", 2600, true, false, false, true],
  ["conveyance", "Conveyance Allowance", 2600, true, true, false, true],
  ["mobile", "Mobile Allowance", 1300, true, false, false, true],
  ["bikeMaintenance", "Bike Maintenance", 1300, true, false, false, true],
  ["technical", "Technical Allowance", 2600, true, false, false, false],
  ["special", "Special Allowance", 1300, false, false, false, false],
].map(([id, name, amount, absent, annualLeave, sickLeave, specialLeave]) => ({
  id: id as string, name: name as string, amount: amount as number,
  deductions: {
    absent: absent as boolean, annualLeave: annualLeave as boolean,
    sickLeave: sickLeave as boolean, specialLeave: specialLeave as boolean,
    lateArrival: false, earlyLeaving: false,
  },
}));
export const LEAVE_TYPES = ["annual", "sick", "special", "compensatory"] as const;
export const REAL_EMPLOYEES = [
  { code: "112009", name: "Himayat Ullah", supplemental: 17, absent: 1, undertime: "0", absenceDeduction: 1600, undertimeDeduction: 0, leaveDeduction: 100, deductions: 1700, net: 41200 },
  { code: "113016", name: "Rahmant Wali", supplemental: 20, absent: 0, undertime: "16.32", absenceDeduction: 0, undertimeDeduction: 2040, leaveDeduction: 0, deductions: 2040, net: 40860 },
  { code: "111007", name: "Sameen Ullah", supplemental: 18, absent: 0, undertime: "3.59", absenceDeduction: 0, undertimeDeduction: 449, leaveDeduction: 500, deductions: 949, net: 41951 },
  { code: "110001", name: "Shahab Gul", supplemental: 17, absent: 2, undertime: "3.68", absenceDeduction: 3200, undertimeDeduction: 460, leaveDeduction: 0, deductions: 3660, net: 39240 },
  { code: "111008", name: "Rafi Ullah", supplemental: 23, absent: 1, undertime: "0.75", absenceDeduction: 1600, undertimeDeduction: 94, leaveDeduction: 0, deductions: 1694, net: 41206 },
  { code: "111006", name: "Anees Ur Rahman", supplemental: 19, absent: 1, undertime: "11.42", absenceDeduction: 1600, undertimeDeduction: 1428, leaveDeduction: 0, deductions: 3028, net: 39872 },
] as const;
export const REAL_RESOLUTIONS = [
  { row: 9, code: "112009", date: "2026-10-07", status: "leave", leaveType: "annual" },
  { row: 10, code: "112009", date: "2026-10-11", status: "absent" },
  { row: 13, code: "112009", date: "2026-10-14", status: "absent" },
  { row: 21, code: "113016", date: "2026-10-14", status: "leave", leaveType: "sick" },
  { row: 31, code: "111007", date: "2026-10-14", status: "leave", leaveType: "special" },
  { row: 36, code: "110001", date: "2026-10-07", status: "leave", leaveType: "compensatory", compHours: 8 },
  { row: 38, code: "110001", date: "2026-10-10", status: "absent" },
  { row: 39, code: "110001", date: "2026-10-11", status: "absent" },
  { row: 42, code: "110001", date: "2026-10-14", status: "absent" },
  { row: 46, code: "111008", date: "2026-10-14", status: "absent" },
  { row: 51, code: "111006", date: "2026-10-11", status: "absent" },
  { row: 54, code: "111006", date: "2026-10-14", status: "absent" },
] as const;
export const CONTROLLED_EMPLOYEES = [
  { code: "E2E01", name: "Baseline Worker", net: 42900, deductions: 0 },
  { code: "E2E02", name: "Annual Worker", net: 42800, deductions: 100, leaveType: "annual" },
  { code: "E2E03", name: "Sick Worker", net: 42900, deductions: 0, leaveType: "sick" },
  { code: "E2E04", name: "Special Worker", net: 42400, deductions: 500, leaveType: "special" },
  { code: "E2E05", name: "Comp Worker", net: 42900, deductions: 0, leaveType: "compensatory", compHours: 8 },
  { code: "E2E06", name: "Partial Worker", net: 42400, deductions: 500, leaveType: "compensatory", compHours: 4 },
  { code: "E2E07", name: "Rounding Worker", net: 42897, deductions: 3, punches: "09:00, 16:59" },
  { code: "E2E08", name: "Break Worker", net: 42775, deductions: 125, punches: "09:00, 12:00, 13:00, 17:00" },
  { code: "E2E09", name: "Undertime Worker", net: 42650, deductions: 250, punches: "09:00, 15:00" },
  { code: "E2E10", name: "Absent Worker", net: 41300, deductions: 1600, status: "absent" },
  { code: "E2E11", name: "Overtime Worker", net: 43150, deductions: 0, punches: "09:00, 19:00", overtime: 2 },
] as const;
export const MANDATORY_CASES = [
  ...Array.from({ length: 16 }, (_, i) => `L${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 14 }, (_, i) => `A${String(i + 1).padStart(2, "0")}`),
  ...Array.from({ length: 8 }, (_, i) => `P${String(i + 1).padStart(2, "0")}`),
  "COMPOSITE", "REAL_FILE",
];
export const wholeRupees = (value: Big.BigSource) => new Big(value).round(0, Big.roundHalfUp).toNumber();

export function expectedBreakdown(person: { code: string; deductions: number; absent?: number; undertimeDeduction?: number; leaveDeduction?: number; leaveType?: string; status?: string; compHours?: number }) {
  const absent = person.absent ?? (person.status === "absent" ? 1 : 0);
  const annual = person.leaveType === "annual" || person.leaveDeduction === 100 ? 1 : 0;
  const special = person.leaveType === "special" || person.leaveDeduction === 500 ? 1 : 0;
  const controlledUndertime: Record<string, number> = { E2E06: 500, E2E07: 3, E2E08: 125, E2E09: 250 };
  const undertime = person.undertimeDeduction ?? controlledUndertime[person.code] ?? 0;
  return {
    standardBreakdown: { basicSalary: 26000, houseRent: 5200, utilities: 2600, conveyance: 2600, mobile: 1300, bikeMaintenance: 1300, technical: 2600, special: 1300 },
    componentDeductions: {
      basicSalary: absent * 1000 + undertime, houseRent: (absent + special) * 200,
      utilities: (absent + special) * 100, conveyance: (absent + special + annual) * 100,
      mobile: (absent + special) * 50, bikeMaintenance: (absent + special) * 50,
      technical: absent * 100, special: 0,
    },
    deductionBreakdownByOccasion: { absent: absent * 1600, undertime, specialLeave: special * 500, annualLeave: annual * 100, sickLeave: 0, unapprovedLeave: 0, notEmployed: 0 },
  };
}

export function controlledReport() {
  const rows = CONTROLLED_EMPLOYEES.flatMap((employee) => WORKING_DATES.map((date) => {
    const punches = date === "2026-10-01" && "punches" in employee ? employee.punches : "09:00, 17:00";
    return `${employee.code},${employee.name},Synthetic payroll E2E,${date},${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(date + "T00:00:00Z").getUTCDay()]},${punches.split(",").length},"${punches}"`;
  }));
  return "Person ID,Person Name,Department,Date,Weekday,No. of Punch(s),Punch Records\r\n" + rows.join("\r\n");
}
