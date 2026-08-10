import { createServerFn } from "@tanstack/react-start";
import { db } from "@/db";
import { createId } from "@paralleldrive/cuid2";
import { invoices } from "@/db/schemas/sales-schema";
import { payments } from "@/db/schemas/sales-erp-schema";
import { transactions, wallets } from "@/db/schemas/finance-schema";
import {
  requireSalesManageMiddleware,
  requireSalesViewMiddleware,
} from "@/lib/middlewares";
import { eq, sql, desc, and, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { expenses } from "@/db/schemas/finance-schema";
import { recordRecoveryPayment } from "./settlement-service";

export const getPaymentsFn = createServerFn()
  .middleware([requireSalesViewMiddleware])
  .inputValidator(
    z.object({
      customerId: z.string().optional(),
      page: z.number().default(1),
      limit: z.number().default(50),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const offset = (data.page - 1) * data.limit;

    const filters = [];

    if (data.customerId) {
      filters.push(eq(payments.customerId, data.customerId));
    }

    if (data.dateFrom) {
      filters.push(gte(payments.effectiveDate, new Date(data.dateFrom)));
    }

    if (data.dateTo) {
      const endOfDay = new Date(data.dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      filters.push(lte(payments.effectiveDate, endOfDay));
    }

    const whereClause = filters.length > 0 ? and(...filters) : undefined;

    const results = await db.query.payments.findMany({
      where: whereClause,
      with: {
        customer: true,
        recordedBy: {
          columns: { name: true },
        },
      },
      limit: data.limit,
      offset,
      orderBy: [desc(payments.effectiveDate), desc(payments.paymentDate)],
    });

    const totalResult = await db
      .select({ count: sql<number>`count(*)` })
      .from(payments)
      .where(whereClause);

    return {
      data: results,
      total: Number(totalResult[0]?.count || 0),
      pageCount: Math.ceil(Number(totalResult[0]?.count || 0) / data.limit),
    };
  });

// ═══════════════════════════════════════════════════════════════════════════
// RECORD EXPENSE OFFSET
// Creates the company expense and settles the same amount against one invoice.
// The expense debits its wallet; settlement adds no wallet credit.
// ═══════════════════════════════════════════════════════════════════════════
export const recordExpenseOffsetFn = createServerFn()
  .middleware([requireSalesManageMiddleware])
  .inputValidator((input: unknown) =>
    z
      .object({
        customerId: z.string().min(1),
        invoiceId: z.string().min(1, "Invoice is required"),
        amount: z.number().positive(),
        expenseDescription: z.string().trim().min(1),
        expenseCategoryId: z.string().min(1),
        expenseCategory: z.string().trim().min(1),
        walletId: z.string().min(1),
        expenseDate: z.coerce.date().default(() => new Date()),
        notes: z.string().optional(),
        reference: z.string().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.session.user.id;

    return db.transaction(async (tx) => {
      const invoice = await tx.query.invoices.findFirst({
        where: eq(invoices.id, data.invoiceId),
        columns: { customerId: true },
        with: { customer: { columns: { name: true } } },
      });
      if (!invoice) throw new Error("Invoice not found");
      if (invoice.customerId !== data.customerId) {
        throw new Error("Invoice does not belong to this customer");
      }

      const wallet = await tx.query.wallets.findFirst({
        where: eq(wallets.id, data.walletId),
        columns: { id: true },
      });
      if (!wallet) throw new Error("Expense account was not found");

      const expenseId = createId();
      await tx.insert(expenses).values({
        id: expenseId,
        description: data.expenseDescription,
        category: data.expenseCategory,
        categoryId: data.expenseCategoryId,
        expenseDate: data.expenseDate,
        amount: data.amount.toString(),
        walletId: data.walletId,
        performedById: userId,
        slipNumber: data.reference,
        remarks: `Expense offset against customer: ${invoice.customer.name}`,
      });

      await tx
        .update(wallets)
        .set({ balance: sql`${wallets.balance} - ${data.amount}` })
        .where(eq(wallets.id, data.walletId));

      await tx.insert(transactions).values({
        id: createId(),
        walletId: data.walletId,
        type: "debit",
        amount: data.amount.toString(),
        referenceId: expenseId,
        source: "Expense Offset",
        effectiveDate: data.expenseDate,
        performedById: userId,
      });

      return recordRecoveryPayment(tx, {
        invoiceId: data.invoiceId,
        actorId: userId,
        payment: {
          method: "expense_offset",
          amount: data.amount,
          paymentDate: data.expenseDate,
          expenseType: data.expenseCategory,
          sourceRecordId: expenseId,
          reference: data.reference,
          notes: data.notes,
        },
      });
    });
  });
