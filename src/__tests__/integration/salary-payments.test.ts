import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { reportDateKey } from "@/lib/report-dates";
import { slipPaymentState } from "@/lib/hr/salary-payments";
import { paySalaries } from "@/server-functions/hr/payroll/salary-payments.server";
import { salaryFixture } from "./salary-fixture";

type Fixture = Awaited<ReturnType<typeof salaryFixture>>;
const payFor = (f: Fixture, employeeIds: string[], walletId: string, paymentDate: string) =>
  db.transaction((tx) => paySalaries(tx, { ...f.base, employeeIds, walletId, paymentDate }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("paying salaries", () => {
  it("pays the chosen slips from one account, one dated Ledger line each", async () => {
    const f = await salaryFixture();
    const [shahab] = f.staff;

    expect(await payFor(f, [shahab.employee.id], f.cash.id, `${f.year}-11-30`)).toEqual({ paidCount: 1, total: "26200.00" });

    expect(await f.balanceOf(f.cash.id)).toBe("173800.00");
    const [row] = await f.rows(shahab.employee.id);
    expect(row).toMatchObject({ kind: "payment", amount: "26200.00", walletId: f.cash.id, paymentDate: `${f.year}-11-30`, status: "active", recordedById: f.actor.id });
    const line = await f.line(row.transactionId!);
    expect(line).toMatchObject({ type: "debit", amount: "26200.00", source: `Payroll - Nov ${f.year}`, description: `Salary — ${shahab.name} — Nov ${f.year}`, referenceId: row.id });
    expect(reportDateKey(line.effectiveDate)).toBe(`${f.year}-11-30`);
    expect(await f.rows(f.staff[1].employee.id)).toHaveLength(0);
  });

  it("blocks the whole payment when the account is short", async () => {
    const f = await salaryFixture({ cash: "30000.00" });
    await expect(payFor(f, f.staff.map((s) => s.employee.id), f.cash.id, f.todayKey))
      .rejects.toThrow(`${f.cash.name} has Rs 30,000. Needed Rs 1,26,200. Short by Rs 96,200.`);
    expect(await f.balanceOf(f.cash.id)).toBe("30000.00");
    expect(await f.rows(f.staff[0].employee.id)).toHaveLength(0);
  });

  it("rejects a future date and a date before the payroll month", async () => {
    const f = await salaryFixture();
    const ids = [f.staff[0].employee.id];
    await expect(payFor(f, ids, f.cash.id, `${f.year}-12-04`)).rejects.toThrow("Payment date can't be in the future");
    await expect(payFor(f, ids, f.cash.id, `${f.year}-10-31`)).rejects.toThrow(`Payment date can't be before 1 Nov ${f.year}`);
  });

  it("never pays the same slip twice, even when two people click at once", async () => {
    const f = await salaryFixture();
    const ids = [f.staff[0].employee.id];
    const results = await Promise.allSettled([payFor(f, ids, f.cash.id, f.todayKey), payFor(f, ids, f.bank.id, f.todayKey)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(String(failed.reason)).toContain("has nothing left to pay");
    expect(await f.rows(f.staff[0].employee.id)).toHaveLength(1);
  });

  it("pays only the balance due after a revision raises the net", async () => {
    const f = await salaryFixture();
    const rafi = f.staff[0];
    await payFor(f, [rafi.employee.id], f.cash.id, f.todayKey);
    await f.setNet(rafi.employee.id, "28200.00");

    expect(await payFor(f, [rafi.employee.id], f.bank.id, f.todayKey)).toEqual({ paidCount: 1, total: "2000.00" });
    const rows = await f.rows(rafi.employee.id);
    expect(rows.map((r) => [r.amount, r.walletId])).toEqual([["26200.00", f.cash.id], ["2000.00", f.bank.id]]);
    expect(slipPaymentState("28200.00", rows).status).toBe("paid");
  });
});
