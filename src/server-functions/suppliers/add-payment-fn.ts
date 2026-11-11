import { createServerFn } from "@tanstack/react-start";
import { db, supplierPayments, purchaseRecords, wallets, expenses, transactions } from "@/db";
import { requireSuppliersManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { expenseCategories } from "@/db/schemas/finance-schema";
import { logActivityQuiet } from "@/lib/activity-logger.server";
import Big from "big.js";

type FinanceWriter = Pick<typeof db, "query" | "select" | "insert" | "update">;

async function ensureSupplierPurchaseCategory(tx: FinanceWriter) {
  const existingCategory = await tx.query.expenseCategories.findFirst({
    where: eq(expenseCategories.slug, "supplier-purchase"),
    columns: { id: true, name: true, isActive: true, isArchived: true },
  });

  if (existingCategory) {
    if (!existingCategory.isActive || existingCategory.isArchived) {
      await tx
        .update(expenseCategories)
        .set({ name: "Supplier Purchase", isActive: true, isArchived: false, updatedAt: new Date() })
        .where(eq(expenseCategories.id, existingCategory.id));
    }
    return { id: existingCategory.id, name: "Supplier Purchase" };
  }

  const [createdCategory] = await tx
    .insert(expenseCategories)
    .values({
      id: createId(),
      name: "Supplier Purchase",
      slug: "supplier-purchase",
      sortOrder: 500,
      isActive: true,
      isArchived: false,
    })
    .returning({ id: expenseCategories.id, name: expenseCategories.name });

  return createdCategory;
}

const addPaymentSchema = z.object({
  supplierId: z.string(),
  purchaseId: z.string().optional(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, "Enter a valid payment amount")
    .refine(value => new Big(value).gt(0) && new Big(value).lte("9999999999.99"), "Payment amount must be positive and within range"),
  paymentDate: z.date().default(() => new Date()),
  walletId: z.string(),
  supplierName: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

export const addPaymentFn = createServerFn({ method: "POST" })
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(addPaymentSchema)
  .handler(async ({ data, context }) => {
    const supplier = await db.query.suppliers.findFirst({
      where: (s, { eq }) => eq(s.id, data.supplierId),
      columns: { supplierName: true }
    });
    const resolvedSupplierName = supplier?.supplierName || data.supplierName || data.supplierId;

    const result = await db.transaction(async (tx) => {
      if (data.purchaseId) {
        // Share the void/edit lock; validate ownership and remaining balance before writing a payment.
        const [purchase] = await tx
          .select()
          .from(purchaseRecords)
          .where(eq(purchaseRecords.id, data.purchaseId)).for("update");

        if (!purchase) throw new Error("Purchase record not found");
        if (purchase.supplierId !== data.supplierId) throw new Error("Purchase does not belong to this supplier");
        if (purchase.voidedAt) throw new Error("Purchase is already voided");

        const totalCost = new Big(purchase.cost);
        const alreadyPaid = new Big(purchase.paidAmount);
        const incomingAmount = new Big(data.amount);
        const remaining = totalCost.minus(alreadyPaid);

        if (incomingAmount.gt(remaining)) {
          throw new Error(
            `Payment of PKR ${incomingAmount.toFixed(2)} exceeds the outstanding balance of PKR ${remaining.toFixed(2)} (Total: PKR ${totalCost.toFixed(2)}, Already paid: PKR ${alreadyPaid.toFixed(2)})`,
          );
        }

        await tx
          .update(purchaseRecords)
          .set({
            paidAmount: sql`${purchaseRecords.paidAmount} + ${data.amount}`,
            updatedAt: new Date(),
          })
          .where(eq(purchaseRecords.id, data.purchaseId));
      }

      const [payment] = await tx
        .insert(supplierPayments)
        .values({
          supplierId: data.supplierId,
          purchaseId: data.purchaseId,
          amount: data.amount,
          paymentDate: data.paymentDate,
          walletId: data.walletId,
          reference: data.reference,
          notes: data.notes,
        })
        .returning();

      if (data.walletId !== "pay_later") {
        const [wallet] = await tx
          .select()
          .from(wallets)
          .where(eq(wallets.id, data.walletId));

        if (!wallet) throw new Error("Wallet not found");

        const currentBalance = parseFloat(wallet.balance || "0");
        const paymentAmount = parseFloat(data.amount);

        if (currentBalance < paymentAmount) {
          throw new Error(
            `Insufficient balance in "${wallet.name}". Available: PKR ${currentBalance.toLocaleString()}, Required: PKR ${paymentAmount.toLocaleString()}`,
          );
        }

        // Debit wallet
        await tx
          .update(wallets)
          .set({ balance: sql`${wallets.balance} - ${data.amount}` })
          .where(eq(wallets.id, data.walletId));

        // Insert expense
        const expenseCategory = await ensureSupplierPurchaseCategory(tx);
        const expenseId = createId();
        const supplierLabel = data.supplierName ?? data.supplierId;
        await tx.insert(expenses).values({
          id: expenseId,
          description: `Supplier Purchase: payment to ${supplierLabel}`,
          category: expenseCategory.name,
          categoryId: expenseCategory.id,
          amount: data.amount,
          walletId: data.walletId,
          performedById: context.session.user.id,
        });

        // Insert transaction journal entry
        await tx.insert(transactions).values({
          id: createId(),
          walletId: data.walletId,
          type: "debit",
          amount: data.amount,
          source: "Expense",
          referenceId: expenseId,
          performedById: context.session.user.id,
        });
      }

      return payment;
    });

    await logActivityQuiet({
      module: "suppliers",
      action: "created",
      entityType: "payment",
      entityId: result.id,
      entityLabel: data.amount.toString(),
      actorId: context.session.user.id,
      actorName: context.session.user.name,
      description: `Added payment of ${data.amount} for supplier ${resolvedSupplierName}`,
      severity: "info",
      metadata: {
        paymentId: result.id,
        supplierId: data.supplierId,
        supplierName: resolvedSupplierName,
        purchaseId: data.purchaseId ?? null,
        amount: data.amount,
        walletId: data.walletId,
        reference: data.reference ?? null,
      },
    });

    return result;
  });
