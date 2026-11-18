import { createServerFn } from "@tanstack/react-start";
import { createId } from "@paralleldrive/cuid2";
import Big from "big.js";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { user } from "@/db/schemas/auth-schema";
import { otherIncome, transactions, wallets } from "@/db/schemas/finance-schema";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import { formatRupees } from "@/lib/finance/expense-entry";
import { BY_PRODUCT_TX_SOURCE, MAX_SALE_AMOUNT, saleAmount } from "@/lib/finance/by-product-sales";
import { containerKey, normalizeContainerName } from "@/lib/inventory/by-products";
import { listByProducts, loadItemByProducts, lockByProductMaterial } from "@/lib/inventory/by-products.server";
import { requireFinanceManageMiddleware, requireFinanceViewMiddleware } from "@/lib/middlewares";
import { reportDateBounds, reportMonth } from "@/lib/report-dates";
import { parseExpenseDate, type Tx } from "./expense-writes.server";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Invalid month");

/**
 * Adds or removes money on one account and writes its ledger row. A debit is refused when the
 * account holds less than the amount; the balance check and update are one row-locking statement.
 */
async function moveWalletMoney(
  tx: Tx,
  input: {
    walletId: string;
    type: "credit" | "debit";
    amount: string;
    referenceId: string;
    performedById: string;
    description: string;
  },
): Promise<string> {
  const [wallet] = await tx
    .update(wallets)
    .set({
      balance:
        input.type === "credit"
          ? sql`${wallets.balance} + ${input.amount}`
          : sql`${wallets.balance} - ${input.amount}`,
    })
    .where(
      input.type === "debit"
        ? and(eq(wallets.id, input.walletId), gte(wallets.balance, input.amount))
        : eq(wallets.id, input.walletId),
    )
    .returning({ id: wallets.id });

  if (!wallet) {
    const existing = await tx.query.wallets.findFirst({
      where: eq(wallets.id, input.walletId),
      columns: { name: true, balance: true },
    });
    if (!existing) throw new Error("Account not found");
    throw new Error(
      `${existing.name} has only ${formatRupees(existing.balance)}. Voiding would take it below zero.`,
    );
  }

  const id = createId();
  await tx.insert(transactions).values({
    id,
    walletId: input.walletId,
    type: input.type,
    amount: input.amount,
    source: BY_PRODUCT_TX_SOURCE,
    referenceId: input.referenceId,
    description: input.description,
    performedById: input.performedById,
  });
  return id;
}

export const getByProductsFn = createServerFn()
  .middleware([requireFinanceViewMiddleware])
  .inputValidator(z.object({ month: monthSchema }))
  .handler(async ({ data }) => {
    const { from, to } = reportMonth(`${data.month}-01`);
    const { fromDate, toDate } = reportDateBounds({ dateFrom: from, dateTo: to });
    const rows = await db
      .select({
        id: otherIncome.id,
        incomeDate: otherIncome.incomeDate,
        itemName: otherIncome.itemName,
        quantity: otherIncome.quantity,
        unitPrice: otherIncome.unitPrice,
        amount: otherIncome.amount,
        note: otherIncome.note,
        walletName: wallets.name,
        recordedBy: user.name,
        voidedAt: otherIncome.voidedAt,
        voidReason: otherIncome.voidReason,
      })
      .from(otherIncome)
      .leftJoin(wallets, eq(otherIncome.walletId, wallets.id))
      .leftJoin(user, eq(otherIncome.performedById, user.id))
      .where(and(gte(otherIncome.incomeDate, fromDate!), lte(otherIncome.incomeDate, toDate!)))
      .orderBy(desc(otherIncome.incomeDate), desc(otherIncome.createdAt));

    const total = rows
      .filter((row) => row.voidedAt === null)
      .reduce((sum, row) => sum.plus(row.amount), new Big(0));
    return { byProducts: await listByProducts(), rows, total: total.toFixed(2) };
  });

export const createByProductSaleFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      incomeDate: z.string().min(1, "Please pick a date"),
      materialType: z.enum(["chemical", "packaging"]),
      materialId: z.string().min(1, "Please pick the by-product"),
      containerName: z.string().transform(normalizeContainerName).pipe(z.string().min(1).max(40)),
      containerSize: z.string().min(1),
      quantity: z.number().int("Quantity must be a whole number").positive("Quantity must be above zero").max(999_999),
      unitPrice: z
        .number()
        .finite()
        .positive("Price must be above zero")
        .max(MAX_SALE_AMOUNT)
        .refine((value) => new Big(value).round(2).eq(value), "Price can have at most 2 decimals (paisa)"),
      walletId: z.string().min(1, "Please pick the account"),
      note: z.string().trim().max(500).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const incomeDate = parseExpenseDate(data.incomeDate);
    const unitPrice = new Big(data.unitPrice);
    const amount = saleAmount(data.quantity, unitPrice.toFixed(2));
    const userId = context.session.user.id;
    const id = createId();
    const ref = { materialType: data.materialType, materialId: data.materialId } as const;
    const key = containerKey(data.containerName, data.containerSize);

    return await db.transaction(async (tx) => {
      await lockByProductMaterial(tx, ref);
      const byProduct = (await loadItemByProducts(tx, ref)).find(
        (row) => containerKey(row.containerName, row.containerSize) === key,
      );
      if (!byProduct) throw new Error("This by-product is not tracked");
      if (data.quantity > byProduct.inHand) {
        throw new Error(`Only ${Math.max(byProduct.inHand, 0)} ${byProduct.label} in hand`);
      }

      const transactionId = await moveWalletMoney(tx, {
        walletId: data.walletId,
        type: "credit",
        amount,
        referenceId: id,
        performedById: userId,
        description: `By-product sale: ${byProduct.label}`,
      });

      const [row] = await tx
        .insert(otherIncome)
        .values({
          id,
          incomeDate,
          itemName: byProduct.label,
          chemicalId: ref.materialType === "chemical" ? ref.materialId : null,
          packagingMaterialId: ref.materialType === "packaging" ? ref.materialId : null,
          containerName: byProduct.containerName,
          containerSize: byProduct.containerSize,
          quantity: data.quantity.toFixed(3),
          unitPrice: unitPrice.toFixed(2),
          amount,
          note: data.note || null,
          walletId: data.walletId,
          transactionId,
          performedById: userId,
        })
        .returning();

      logActivityQuiet({
        module: "finance",
        action: "created",
        entityType: "by_product_sale",
        entityId: id,
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Sold ${data.quantity} ${byProduct.label} for ${amount}`,
      });

      return row;
    });
  });

export const voidByProductSaleFn = createServerFn()
  .middleware([requireFinanceManageMiddleware])
  .inputValidator(
    z.object({
      id: z.string().min(1),
      reason: z.string().trim().min(3, "Please give a reason").max(500),
    }),
  )
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id;

    return await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(otherIncome)
        .where(eq(otherIncome.id, data.id))
        .for("update");
      if (!current) throw new Error("Sale not found");
      if (current.voidedAt) throw new Error("This entry is already voided");

      const voidTransactionId = await moveWalletMoney(tx, {
        walletId: current.walletId,
        type: "debit",
        amount: current.amount,
        referenceId: current.id,
        performedById: userId,
        description: `Void of by-product sale: ${current.itemName}`,
      });

      const [voided] = await tx
        .update(otherIncome)
        .set({ voidedAt: new Date(), voidedById: userId, voidReason: data.reason, voidTransactionId })
        .where(eq(otherIncome.id, current.id))
        .returning();

      logActivityQuiet({
        module: "finance",
        action: "deleted",
        entityType: "by_product_sale",
        entityId: current.id,
        actorId: context.authContext.session.user.id,
        actorName: context.authContext.session.user.name,
        description: `Voided by-product sale of ${current.amount}: ${data.reason}`,
      });

      return voided;
    });
  });
