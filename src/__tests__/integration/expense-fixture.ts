import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, expenses, transactions, user, wallets } from "@/db";
import { expenseCategories } from "@/db/schemas/finance-schema";

export const EXPENSE_DAY = "2026-10-12T05:00:00.000Z"; // shows as "12 Oct 2026"

// Each call commits its own rows with unique names, so suites never share accounts or categories.
export async function expenseFixture(balance = "10000.00") {
  const id = randomUUID();
  const [actor] = await db.insert(user).values({ id, name: "Accountant", email: `${id}@test.invalid` }).returning();
  const [cash] = await db.insert(wallets).values({ id: `cash-${id}`, name: `Cash ${id.slice(0, 8)}`, type: "cash", balance }).returning();
  const [bank] = await db.insert(wallets).values({ id: `bank-${id}`, name: `Bank ${id.slice(0, 8)}`, type: "bank", balance: "50000.00" }).returning();
  const [fuel] = await db.insert(expenseCategories).values({ name: `Fuel ${id}`, slug: `fuel-${id}` }).returning();
  const [rent] = await db.insert(expenseCategories).values({ name: `Rent ${id}`, slug: `rent-${id}` }).returning();
  const context = { session: { user: actor }, authContext: { session: { user: actor } } };

  const balanceOf = async (walletId: string) =>
    (await db.select().from(wallets).where(eq(wallets.id, walletId)))[0].balance;
  const expense = async (expenseId: string) =>
    (await db.select().from(expenses).where(eq(expenses.id, expenseId)))[0];
  const moves = async (expenseId: string) =>
    db.select().from(transactions).where(eq(transactions.referenceId, expenseId));

  return { id, actor, cash, bank, fuel, rent, context, balanceOf, expense, moves };
}
