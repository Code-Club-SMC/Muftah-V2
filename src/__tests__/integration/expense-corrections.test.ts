import { createId } from "@paralleldrive/cuid2";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db, expenses, transactions, wallets } from "@/db";
import {
  categoryFieldOptions,
  categoryFields,
  expenseCategories,
  expenseEdits,
  expenseFieldValues,
} from "@/db/schemas/finance-schema";
import {
  EXPENSE_AUTO_LOCK_MESSAGE,
  EXPENSE_VOIDED_MESSAGE,
  OVERDRAW_CONFIRM_REQUIRED,
} from "@/lib/finance/expense-corrections";
import { createExpenseFn } from "@/server-functions/finance-fn";
import { updateExpenseFn, voidExpenseFn } from "@/server-functions/finance/expense-corrections-fn";
import { EXPENSE_DAY, expenseFixture } from "./expense-fixture";

// Only HTTP/session transport is bypassed; validators, handlers and SQL are real.
vi.mock("@tanstack/react-start", () => ({ createServerFn: () => {
  let validator: { parse: (data: unknown) => unknown } | undefined;
  const builder = {
    middleware: () => builder,
    inputValidator: (schema: typeof validator) => { validator = schema; return builder; },
    handler: (handler: (input: unknown) => unknown) => (input: { data?: unknown; context: unknown }) =>
      handler({ ...input, data: validator ? validator.parse(input.data) : input.data }),
  };
  return builder;
} }));
vi.mock("@/lib/middlewares", () => ({ requireFinanceManageMiddleware: {}, requireFinanceViewMiddleware: {}, requireSuperAdminMiddleware: {} }));
vi.mock("@/lib/activity-logger.server", () => ({ logActivityQuiet: vi.fn() }));

type Fixture = Awaited<ReturnType<typeof expenseFixture>>;

const record = async (f: Fixture, amount: number, extra: Record<string, unknown> = {}) =>
  (await createExpenseFn({
    data: { categoryId: f.fuel.id, amount, walletId: f.cash.id, expenseDate: EXPENSE_DAY, ...extra },
    context: f.context,
  } as never)) as { id: string };

const edit = async (f: Fixture, expenseId: string, changes: Record<string, unknown>) =>
  updateExpenseFn({
    data: { expenseId, categoryId: f.fuel.id, amount: 5000, walletId: f.cash.id, expenseDate: EXPENSE_DAY, ...changes },
    context: f.context,
  } as never) as Promise<{ changed: boolean }>;

const voidIt = async (f: Fixture, expenseId: string, reason = "Entered twice") =>
  voidExpenseFn({ data: { expenseId, reason }, context: f.context } as never);

const corrections = async (f: Fixture, expenseId: string) =>
  (await f.moves(expenseId))
    .filter((m) => m.description)
    .map((m) => [m.type, m.amount, m.walletId, m.description])
    .sort();

const editLog = async (expenseId: string) =>
  db.select().from(expenseEdits).where(eq(expenseEdits.expenseId, expenseId));

describe.skipIf(!process.env.TEST_DATABASE_URL)("editing and voiding expenses", () => {
  it("corrects the account today and logs the change when the amount goes up", async () => {
    const f = await expenseFixture();
    const { id } = await record(f, 5000);

    expect(await edit(f, id, { amount: 5500, payee: "LESCO", description: "October bill" })).toEqual({ changed: true });

    expect(await f.balanceOf(f.cash.id)).toBe("4500.00");
    expect(await corrections(f, id)).toEqual([["debit", "500.00", f.cash.id, "Correction to expense of 12 Oct 2026"]]);
    const [log] = await editLog(id);
    expect(log.editedById).toBe(f.actor.id);
    expect(log.changes).toEqual([
      { field: "Amount", from: "Rs 5,000", to: "Rs 5,500" },
      { field: "Paid to", from: "", to: "LESCO" },
      { field: "Note", from: "", to: "October bill" },
    ]);
    expect(await f.expense(id)).toMatchObject({ amount: "5500.00", payee: "LESCO", description: "October bill" });
  });

  it("gives money back when the amount goes down, even by paisa", async () => {
    const f = await expenseFixture();
    const { id } = await record(f, 5000);

    await edit(f, id, { amount: 4999.5 });

    expect(await f.balanceOf(f.cash.id)).toBe("5000.50");
    expect(await corrections(f, id)).toEqual([["credit", "0.50", f.cash.id, "Correction to expense of 12 Oct 2026"]]);
    expect((await editLog(id))[0].changes).toEqual([{ field: "Amount", from: "Rs 5,000", to: "Rs 4,999.50" }]);
  });

  it("moves the money when the account changes", async () => {
    const f = await expenseFixture();
    const { id } = await record(f, 5000);

    await edit(f, id, { walletId: f.bank.id });

    expect(await f.balanceOf(f.cash.id)).toBe("10000.00");
    expect(await f.balanceOf(f.bank.id)).toBe("45000.00");
    expect(await corrections(f, id)).toEqual([
      ["credit", "5000.00", f.cash.id, "Correction to expense of 12 Oct 2026"],
      ["debit", "5000.00", f.bank.id, "Correction to expense of 12 Oct 2026"],
    ]);
    const [log] = await editLog(id);
    expect(log.changes).toEqual([{ field: "Paid from", from: f.cash.name, to: f.bank.name }]);
  });

  it("still logs a move between two accounts that share a name", async () => {
    const f = await expenseFixture();
    await db.update(wallets).set({ name: f.cash.name }).where(eq(wallets.id, f.bank.id));
    const { id } = await record(f, 5000);

    expect(await edit(f, id, { walletId: f.bank.id })).toEqual({ changed: true });

    expect((await editLog(id))[0].changes).toEqual([
      { field: "Paid from", from: `${f.cash.name} (${f.cash.id})`, to: `${f.cash.name} (${f.bank.id})` },
    ]);
  });

  it("saves nothing when nothing changed", async () => {
    const f = await expenseFixture();
    const { id } = await record(f, 5000);

    expect(await edit(f, id, {})).toEqual({ changed: false });

    expect(await editLog(id)).toEqual([]);
    expect(await f.moves(id)).toHaveLength(1);
  });

  it("asks before an edit takes the account below zero, and changes nothing until confirmed", async () => {
    const f = await expenseFixture("2000.00");
    const { id } = await record(f, 1000);

    await expect(edit(f, id, { amount: 4000, payee: "Someone" })).rejects.toThrow(OVERDRAW_CONFIRM_REQUIRED);
    expect(await f.balanceOf(f.cash.id)).toBe("1000.00");
    expect(await f.expense(id)).toMatchObject({ amount: "1000.00", payee: null });
    expect(await editLog(id)).toEqual([]);

    await edit(f, id, { amount: 4000, allowOverdraw: true });
    expect(await f.balanceOf(f.cash.id)).toBe("-2000.00");
  });

  it("asks before moving an expense to an account that cannot cover it", async () => {
    const f = await expenseFixture("100.00");
    const { id } = await record(f, 50, { walletId: f.bank.id });

    await expect(edit(f, id, { amount: 500, walletId: f.cash.id })).rejects.toThrow(OVERDRAW_CONFIRM_REQUIRED);
    expect(await f.balanceOf(f.bank.id)).toBe("49950.00");
    expect(await f.balanceOf(f.cash.id)).toBe("100.00");
  });

  it("drops the old category's custom fields when the category changes", async () => {
    const f = await expenseFixture();
    const [vehicle] = await db.insert(categoryFields).values({ categoryId: f.fuel.id, key: "vehicle", label: "Vehicle", fieldType: "text" }).returning();
    const { id } = await record(f, 5000, { fieldValues: [{ fieldId: vehicle.id, fieldType: "text", valueText: "LEA-1234" }] });

    await edit(f, id, { categoryId: f.rent.id });

    expect(await db.select().from(expenseFieldValues).where(eq(expenseFieldValues.expenseId, id))).toEqual([]);
    expect((await editLog(id))[0].changes).toEqual([
      { field: "Category", from: f.fuel.name, to: f.rent.name },
      { field: "Vehicle", from: "LEA-1234", to: "" },
    ]);
  });

  it("keeps values of fields switched off after the expense was recorded", async () => {
    const f = await expenseFixture();
    const [vehicle] = await db.insert(categoryFields).values({ categoryId: f.fuel.id, key: "vehicle", label: "Vehicle", fieldType: "text" }).returning();
    const { id } = await record(f, 5000, { fieldValues: [{ fieldId: vehicle.id, fieldType: "text", valueText: "LEA-1234" }] });
    await db.update(categoryFields).set({ isActive: false }).where(eq(categoryFields.id, vehicle.id));

    await edit(f, id, { amount: 5100 });

    const values = await db.select().from(expenseFieldValues).where(eq(expenseFieldValues.expenseId, id));
    expect(values.map((v) => v.valueText)).toEqual(["LEA-1234"]);
  });

  it("lets an edit keep a category or option that was switched off since, but not pick a new one", async () => {
    const f = await expenseFixture();
    const [kind] = await db.insert(categoryFields).values({ categoryId: f.fuel.id, key: "kind", label: "Kind", fieldType: "select" }).returning();
    const [petrol, diesel] = await db.insert(categoryFieldOptions).values([
      { fieldId: kind.id, value: "petrol", label: "Petrol" },
      { fieldId: kind.id, value: "diesel", label: "Diesel" },
    ]).returning();
    const kindValue = (optionId: string) => [{ fieldId: kind.id, fieldType: "select", valueOptionId: optionId }];
    const { id } = await record(f, 5000, { fieldValues: kindValue(petrol.id) });
    await db.update(categoryFieldOptions).set({ isActive: false }).where(eq(categoryFieldOptions.fieldId, kind.id));
    await db.update(expenseCategories).set({ isActive: false, isArchived: true }).where(eq(expenseCategories.id, f.fuel.id));

    expect(await edit(f, id, { amount: 5100, fieldValues: kindValue(petrol.id) })).toEqual({ changed: true });
    await expect(edit(f, id, { amount: 5100, fieldValues: kindValue(diesel.id) })).rejects.toThrow("invalid option");

    const other = await expenseFixture();
    const { id: otherId } = await record(other, 100);
    await expect(edit(other, otherId, { categoryId: f.fuel.id, amount: 100 })).rejects.toThrow("Please select an active category");
  });

  it("voids an expense, returns the money today and blocks further changes", async () => {
    const f = await expenseFixture();
    const { id } = await record(f, 5000);

    await voidIt(f, id);

    expect(await f.balanceOf(f.cash.id)).toBe("10000.00");
    const row = await f.expense(id);
    expect(row).toMatchObject({ voidReason: "Entered twice", voidedById: f.actor.id });
    expect(row.voidedAt).toBeInstanceOf(Date);
    const [voidMove] = await db.select().from(transactions).where(eq(transactions.id, row.voidTransactionId!));
    expect([voidMove.type, voidMove.amount, voidMove.description]).toEqual(["credit", "5000.00", "Void of expense of 12 Oct 2026"]);

    await expect(voidIt(f, id)).rejects.toThrow(EXPENSE_VOIDED_MESSAGE);
    await expect(edit(f, id, { amount: 10 })).rejects.toThrow(EXPENSE_VOIDED_MESSAGE);
    expect(await f.balanceOf(f.cash.id)).toBe("10000.00");
  });

  it("voiding after edits returns exactly what is still taken, to the current account", async () => {
    const f = await expenseFixture();
    const { id } = await record(f, 5000);
    await edit(f, id, { amount: 7000 });
    await edit(f, id, { amount: 7000, walletId: f.bank.id });

    await voidIt(f, id);

    expect(await f.balanceOf(f.cash.id)).toBe("10000.00");
    expect(await f.balanceOf(f.bank.id)).toBe("50000.00");
  });

  it("returns money on void even when that account is overdrawn", async () => {
    const f = await expenseFixture("100.00");
    const { id } = await record(f, 500, { allowOverdraw: true });
    await voidIt(f, id);
    expect(await f.balanceOf(f.cash.id)).toBe("100.00");
  });

  it("needs a reason to void", async () => {
    const f = await expenseFixture();
    const { id } = await record(f, 5000);
    await expect(voidIt(f, id, "  ")).rejects.toThrow();
    await expect(voidIt(f, id, " ab ")).rejects.toThrow();
    expect((await f.expense(id)).voidedAt).toBeNull();
  });

  it("refuses unknown expenses", async () => {
    const f = await expenseFixture();
    await expect(edit(f, "missing-expense", {})).rejects.toThrow("Expense not found");
    await expect(voidIt(f, "missing-expense")).rejects.toThrow("Expense not found");
  });

  it("refuses to change expenses made by other screens", async () => {
    const f = await expenseFixture();
    const id = createId();
    await db.insert(expenses).values({
      id, description: "Supplier Purchase: Soda Ash", category: f.fuel.name, categoryId: f.fuel.id,
      amount: "300.00", walletId: f.cash.id, performedById: f.actor.id,
    });

    await expect(edit(f, id, { amount: 10 })).rejects.toThrow(EXPENSE_AUTO_LOCK_MESSAGE);
    await expect(voidIt(f, id)).rejects.toThrow(EXPENSE_AUTO_LOCK_MESSAGE);
  });

  it("applies two edits made at the same moment one after the other", async () => {
    const f = await expenseFixture();
    const { id } = await record(f, 5000);

    await Promise.all([edit(f, id, { amount: 6000 }), edit(f, id, { amount: 7000 })]);

    const final = (await f.expense(id)).amount;
    expect(["6000.00", "7000.00"]).toContain(final);
    expect(await f.balanceOf(f.cash.id)).toBe((10000 - Number(final)).toFixed(2));
  });
});
