import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { wallets } from "@/db/schemas/finance-schema";
import { reportDateKey } from "@/lib/report-dates";
import { slipPaymentState } from "@/lib/hr/salary-payments";
import { changeSalaryAccount, paySalaries, undoSalaryPayment } from "@/server-functions/hr/payroll/salary-payments.server";
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

const changeFor = (f: Fixture, employeeIds: string[], walletId: string, paymentDate: string) =>
  db.transaction((tx) => changeSalaryAccount(tx, { ...f.base, employeeIds, walletId, paymentDate }));
const undoFor = (f: Fixture, employeeId: string, reason: string) =>
  db.transaction((tx) => undoSalaryPayment(tx, { ...f.base, employeeId, reason }));

describe.skipIf(!process.env.TEST_DATABASE_URL)("changing the account and undoing", () => {
  it("moves a paid slip to another account, keeping both lines", async () => {
    const f = await salaryFixture();
    const shahab = f.staff[0];
    await payFor(f, [shahab.employee.id], f.cash.id, `${f.year}-11-30`);

    expect(await changeFor(f, [shahab.employee.id], f.bank.id, `${f.year}-12-01`)).toEqual({ movedCount: 1, total: "26200.00" });

    expect(await f.balanceOf(f.cash.id)).toBe("200000.00");
    expect(await f.balanceOf(f.bank.id)).toBe("473800.00");
    const [old, moved] = await f.rows(shahab.employee.id);
    expect(old).toMatchObject({ status: "reversed", walletId: f.cash.id, reversalReason: `Account changed to ${f.bank.name}`, reversedById: f.actor.id });
    const reversal = await f.line(old.reversalTransactionId!);
    expect(reversal).toMatchObject({ type: "credit", walletId: f.cash.id, amount: "26200.00", reversalOfTransactionId: old.transactionId });
    expect(reversal.description).toBe(`Reversal of salary — ${shahab.name} — Nov ${f.year} — Account changed to ${f.bank.name}`);
    expect(reportDateKey(reversal.effectiveDate)).toBe(f.todayKey);
    expect(moved).toMatchObject({ status: "active", walletId: f.bank.id, amount: "26200.00", paymentDate: `${f.year}-12-01` });
  });

  it("refuses an unpaid slip, a slip already on that account, and a short account", async () => {
    const f = await salaryFixture();
    const [a, b] = f.staff;
    await expect(changeFor(f, [a.employee.id], f.bank.id, f.todayKey)).rejects.toThrow(`${a.name} is not paid yet.`);
    await payFor(f, [a.employee.id, b.employee.id], f.bank.id, f.todayKey);
    await expect(changeFor(f, [a.employee.id], f.bank.id, f.todayKey)).rejects.toThrow(`${a.name} is already paid from ${f.bank.name}.`);
    await db.update(wallets).set({ balance: "1000.00" }).where(eq(wallets.id, f.cash.id));
    await expect(changeFor(f, [b.employee.id], f.cash.id, f.todayKey)).rejects.toThrow("Short by Rs 99,000.");
    expect(await f.balanceOf(f.bank.id)).toBe("373800.00");
  });

  it("undoes a payment: money back, slip unpaid again", async () => {
    const f = await salaryFixture();
    const a = f.staff[0];
    await payFor(f, [a.employee.id], f.cash.id, f.todayKey);
    await expect(undoFor(f, a.employee.id, "no")).rejects.toThrow("Give a reason of at least 3 characters");

    expect(await undoFor(f, a.employee.id, "Paid twice by mistake")).toEqual({ reversedCount: 1 });

    expect(await f.balanceOf(f.cash.id)).toBe("200000.00");
    const rows = await f.rows(a.employee.id);
    expect(rows[0]).toMatchObject({ status: "reversed", reversalReason: "Paid twice by mistake" });
    expect(slipPaymentState("26200.00", rows).status).toBe("unpaid");
    await expect(undoFor(f, a.employee.id, "Again")).rejects.toThrow(`${a.name} has no payment to undo.`);
  });
});
