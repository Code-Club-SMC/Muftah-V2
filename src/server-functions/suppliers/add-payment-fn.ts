import { createServerFn } from "@tanstack/react-start";
import { db, supplierPayments, purchaseRecords, wallets, expenses, transactions } from "@/db";
import { requireSuppliersManageMiddleware } from "@/lib/middlewares";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { expenseCategories } from "@/db/schemas/finance-schema";

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
  amount: z.string().min(1, "Amount is required"),
  paymentDate: z.date().default(() => new Date()),
  walletId: z.string(),
  supplierName: z.string().optional(),
  reference: z.string().optional(),
  notes: z.string().optional(),
});

export const addPaymentFn = createServerFn()
  .middleware([requireSuppliersManageMiddleware])
  .inputValidator(addPaymentSchema)
  .handler(async ({ data, context }) => {
    return await db.transaction(async (tx) => {
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

      if (data.purchaseId) {
        // Overpayment guard — fetch current state inside the transaction
        const [purchase] = await tx
          .select({ cost: purchaseRecords.cost, paidAmount: purchaseRecords.paidAmount })
          .from(purchaseRecords)
          .where(eq(purchaseRecords.id, data.purchaseId));

        if (!purchase) throw new Error("Purchase record not found");

        const totalCost = parseFloat(purchase.cost ?? "0");
        const alreadyPaid = parseFloat(purchase.paidAmount ?? "0");
        const incomingAmount = parseFloat(data.amount);
        const remaining = totalCost - alreadyPaid;

        if (incomingAmount <= 0) {
          throw new Error("Payment amount must be greater than zero");
        }

        if (incomingAmount > remaining) {
          throw new Error(
            `Payment of PKR ${incomingAmount.toLocaleString()} exceeds the outstanding balance of PKR ${remaining.toLocaleString()} (Total: PKR ${totalCost.toLocaleString()}, Already paid: PKR ${alreadyPaid.toLocaleString()})`,
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
  });
