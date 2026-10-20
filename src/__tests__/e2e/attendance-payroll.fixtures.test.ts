import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import Big from "big.js";
import { describe, expect, it } from "vitest";
import { leaveTypeEnum } from "@/db/schemas/hr-schema";
import { ALLOWANCES, CONTROLLED_EMPLOYEES, CYCLE, LEAVE_TYPES, REAL_EMPLOYEES, REAL_RESOLUTIONS, SOURCE, WORKING_DATES, wholeRupees, expectedBreakdown } from "./attendance-payroll.fixtures";

describe("independent attendance payroll acceptance oracle", () => {
  it("enumerates all 26 working dates independently of production calendar helpers", () => {
    const dates: string[] = [];
    for (let stamp = Date.parse(CYCLE.start); stamp <= Date.parse(CYCLE.end); stamp += 86400000) {
      const day = new Date(stamp);
      if (day.getUTCDay() !== 0) dates.push(day.toISOString().slice(0, 10));
    }
    expect(dates).toEqual(WORKING_DATES);
    expect(dates).toHaveLength(26);
  });
  it("reconciles every original-file golden salary and aggregate exactly", () => {
    expect(REAL_EMPLOYEES.reduce((n, e) => n + e.net, 0)).toBe(244329);
    expect(REAL_EMPLOYEES.reduce((n, e) => n + e.deductions, 0)).toBe(13071);
    expect(REAL_EMPLOYEES.reduce((n, e) => n + e.supplemental, 0)).toBe(114);
    for (const e of REAL_EMPLOYEES) {
      expect(wholeRupees(new Big(e.undertime).times(125))).toBe(e.undertimeDeduction);
      expect(e.absenceDeduction + e.undertimeDeduction + e.leaveDeduction).toBe(e.deductions);
      expect(CYCLE.gross - e.deductions).toBe(e.net);
    }
  });
  it("reconciles components, composite and exact rounding boundaries", () => {
    expect(ALLOWANCES.reduce((n, a) => n + a.amount, 26000)).toBe(42900);
    expect(wholeRupees(new Big(8).minus("7.98").times(125))).toBe(3);
    expect(wholeRupees(new Big("0.02").times(125))).toBe(3);
    expect(wholeRupees(new Big(2).times(125).times("1.5"))).toBe(375);
    expect(42900 + 250 + 500 - (1600 + 100 + 500 + 250 + 125)).toBe(41075);
    for (const person of [...REAL_EMPLOYEES, ...CONTROLLED_EMPLOYEES]) {
      const breakdown = expectedBreakdown(person);
      expect(Object.values(breakdown.componentDeductions).reduce((a, b) => a + b, 0)).toBe(person.deductions);
      expect(Object.values(breakdown.deductionBreakdownByOccasion).reduce((a, b) => a + b, 0)).toBe(person.deductions);
    }
  });
  it("covers exactly the current leave enum and twelve explicit real-source decisions", () => {
    expect([...LEAVE_TYPES].sort()).toEqual([...leaveTypeEnum.enumValues].sort());
    expect(REAL_RESOLUTIONS).toHaveLength(12);
    expect(REAL_RESOLUTIONS.filter(e => e.status === "leave").map(e => "leaveType" in e && e.leaveType).sort()).toEqual([...LEAVE_TYPES].sort());
  });
  it("uses the unchanged original workbook bytes", async () => {
    expect(createHash("sha256").update(await readFile(SOURCE.path)).digest("hex")).toBe(SOURCE.sha256);
  });
  it("independently derives original-file undertime and supplemental dates from checked-in XML evidence", async () => {
    const source = JSON.parse(await readFile("src/__tests__/fixtures/attendance-payroll-original.json", "utf8")) as { rows: { code: string; date: string; completedHours: string }[] };
    for (const person of REAL_EMPLOYEES) {
      const rows = source.rows.filter(row => row.code === person.code);
      expect(WORKING_DATES.filter(date => !rows.some(row => row.date === date))).toHaveLength(person.supplemental);
      let undertime = new Big(0);
      for (const row of rows) {
        if (!(WORKING_DATES as readonly string[]).includes(row.date) || REAL_RESOLUTIONS.some(decision => decision.code === row.code && decision.date === row.date)) continue;
        const shortfall = new Big(8).minus(row.completedHours);
        if (shortfall.gt(0)) undertime = undertime.plus(shortfall);
      }
      expect(undertime.toString()).toBe(new Big(person.undertime).toString());
      expect(wholeRupees(undertime.times(125))).toBe(person.undertimeDeduction);
    }
  });
});
