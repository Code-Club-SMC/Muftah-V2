import { createId } from "@paralleldrive/cuid2";
import Big from "big.js";
import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { db as rootDb } from "@/db";
import { transactions, wallets } from "@/db/schemas/finance-schema";
import {
  creditNoteCounters,
  customerCreditLots,
  customerCreditMovements,
  customerCreditPaymentAllocations,
  customerRefundAllocations,
  customerRefunds,
  payments,
  salesReturns,
  slipRecords,
} from "@/db/schemas/sales-erp-schema";
import { customers, invoices } from "@/db/schemas/sales-schema";
import { formatPakistaniNumber } from "@/lib/currency-format";
import { overdrawError } from "@/lib/finance/expense-corrections";
import { hasPermission } from "@/lib/rbac";
import {
  computeReturnCreditSplit,
  formatCreditNoteNumber,
  formatVoidBlockedByRefundError,
  parseVoidBlockedByRefundError,
  VOID_BLOCKED_BY_REFUND,
} from "@/lib/sales/returns/return-lifecycle";
import { moneyString, roundMoney } from "@/lib/sales/settlement/money";

export {
  formatVoidBlockedByRefundError,
  parseVoidBlockedByRefundError,
  VOID_BLOCKED_BY_REFUND,
};

export type DbOrTx = Pick<typeof rootDb, "select" | "insert" | "update" | "query">;

export function selectFifoAllocations(
  requestedAmount: number,
  lots: Array<{ id: string; remainingAmount: string | number; createdAt: Date }>,
): Array<{ lotId: string; amount: number }> {
  const needed = roundMoney(requestedAmount);
  if (needed < 0) throw new Error("Credit allocation amount cannot be negative");
  if (needed === 0) return [];

  let remainingNeeded = new Big(needed);
  const allocations: Array<{ lotId: string; amount: number }> = [];

  for (const lot of lots) {
    if (remainingNeeded.lte(0)) break;
    const avail = new Big(roundMoney(lot.remainingAmount));
    if (avail.lte(0)) continue;
    const take = avail.lt(remainingNeeded) ? avail : remainingNeeded;
    allocations.push({ lotId: lot.id, amount: roundMoney(take.toNumber()) });
    remainingNeeded = remainingNeeded.minus(take);
  }

  if (remainingNeeded.gt(0)) {
    throw new Error("Requested credit amount exceeds available store credit.");
  }
  return allocations;
}

async function lockCustomerRow(tx: DbOrTx, customerId: string) {
  await tx.select({ id: customers.id }).from(customers).where(eq(customers.id, customerId)).for("update");
  const customer = await tx.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: { id: true, name: true, customerType: true, creditBalance: true, outstandingAmount: true },
  });
  if (!customer) throw new Error("Customer not found");
  return customer;
}

async function lockActiveCustomerLots(tx: DbOrTx, customerId: string) {
  return tx
    .select()
    .from(customerCreditLots)
    .where(
      and(
        eq(customerCreditLots.customerId, customerId),
        isNull(customerCreditLots.voidedAt),
        gt(customerCreditLots.remainingAmount, "0"),
      ),
    )
    .orderBy(asc(customerCreditLots.createdAt), asc(customerCreditLots.id))
    .for("update");
}

export async function allocateNextCreditNoteNumber(tx: DbOrTx): Promise<string> {
  await tx
    .insert(creditNoteCounters)
    .values({ id: "credit_note", lastNumber: 0 })
    .onConflictDoNothing();

  const [counter] = await tx
    .select()
    .from(creditNoteCounters)
    .where(eq(creditNoteCounters.id, "credit_note"))
    .for("update");

  const next = Number(counter?.lastNumber ?? 0) + 1;
  await tx
    .update(creditNoteCounters)
    .set({ lastNumber: next, updatedAt: new Date() })
    .where(eq(creditNoteCounters.id, "credit_note"));

  return formatCreditNoteNumber(next);
}

export async function issueCustomerCreditFromReturn(
  tx: DbOrTx,
  input: {
    customerId: string;
    salesReturnId: string;
    sourceInvoiceId: string;
    creditNoteNumber: string;
    amount: number;
    performedById: string;
    notes?: string | null;
  },
): Promise<{ lotId: string; balanceAfter: number }> {
  const creditAmount = roundMoney(input.amount);
  if (creditAmount <= 0) {
    const customer = await lockCustomerRow(tx, input.customerId);
    return { lotId: "", balanceAfter: roundMoney(customer.creditBalance) };
  }

  const customer = await lockCustomerRow(tx, input.customerId);
  const newBalance = roundMoney(new Big(customer.creditBalance).plus(creditAmount).toNumber());

  await tx
    .update(customers)
    .set({ creditBalance: moneyString(newBalance) })
    .where(eq(customers.id, input.customerId));

  const lotId = createId();
  await tx.insert(customerCreditLots).values({
    id: lotId,
    customerId: input.customerId,
    sourceType: "sales_return",
    sourceReturnId: input.salesReturnId,
    sourceInvoiceId: input.sourceInvoiceId,
    creditNoteNumber: input.creditNoteNumber,
    originalAmount: moneyString(creditAmount),
    remainingAmount: moneyString(creditAmount),
    appliedAmount: "0.00",
    refundedAmount: "0.00",
    reclaimedAmount: "0.00",
  });

  await tx.insert(customerCreditMovements).values({
    id: createId(),
    customerId: input.customerId,
    creditLotId: lotId,
    type: "issued",
    amount: moneyString(creditAmount),
    signedDelta: moneyString(creditAmount),
    balanceAfter: moneyString(newBalance),
    salesReturnId: input.salesReturnId,
    creditNoteNumber: input.creditNoteNumber,
    invoiceId: input.sourceInvoiceId,
    notes: input.notes ?? `Credit Note ${input.creditNoteNumber} leftover store credit`,
    performedById: input.performedById,
  });

  return { lotId, balanceAfter: newBalance };
}

export async function issuePaymentOverageCredit(
  tx: DbOrTx,
  input: {
    customerId: string;
    sourceInvoiceId: string;
    sourcePaymentId: string | null;
    amount: number;
    performedById: string;
    notes?: string;
  },
): Promise<{ lotId: string; balanceAfter: number }> {
  const overageAmount = roundMoney(input.amount);
  if (overageAmount <= 0) {
    const customer = await lockCustomerRow(tx, input.customerId);
    return { lotId: "", balanceAfter: roundMoney(customer.creditBalance) };
  }

  const customer = await lockCustomerRow(tx, input.customerId);
  const newBalance = roundMoney(new Big(customer.creditBalance).plus(overageAmount).toNumber());

  await tx
    .update(customers)
    .set({ creditBalance: moneyString(newBalance) })
    .where(eq(customers.id, input.customerId));

  const lotId = createId();
  await tx.insert(customerCreditLots).values({
    id: lotId,
    customerId: input.customerId,
    sourceType: "payment_overage",
    sourceReturnId: null,
    sourceInvoiceId: input.sourceInvoiceId,
    sourcePaymentId: input.sourcePaymentId,
    creditNoteNumber: null,
    originalAmount: moneyString(overageAmount),
    remainingAmount: moneyString(overageAmount),
    appliedAmount: "0.00",
    refundedAmount: "0.00",
    reclaimedAmount: "0.00",
  });

  await tx.insert(customerCreditMovements).values({
    id: createId(),
    customerId: input.customerId,
    creditLotId: lotId,
    type: "issued",
    amount: moneyString(overageAmount),
    signedDelta: moneyString(overageAmount),
    balanceAfter: moneyString(newBalance),
    invoiceId: input.sourceInvoiceId,
    paymentId: input.sourcePaymentId,
    notes: input.notes ?? "Confirmed payment exceeded invoice balance after returns",
    performedById: input.performedById,
  });

  return { lotId, balanceAfter: newBalance };
}

export async function applyCustomerCreditToPayment(
  tx: DbOrTx,
  input: {
    customerId: string;
    paymentId: string;
    invoiceId: string;
    amount: number;
    performedById: string;
    notes?: string | null;
  },
): Promise<{ balanceAfter: number }> {
  const applyAmount = roundMoney(input.amount);
  if (applyAmount <= 0) throw new Error("Store credit amount must be greater than zero");

  const customer = await lockCustomerRow(tx, input.customerId);
  const currentBalance = roundMoney(customer.creditBalance);
  if (applyAmount > currentBalance) {
    throw new Error(
      `Store credit applied (Rs ${formatPakistaniNumber(applyAmount)}) exceeds available credit (Rs ${formatPakistaniNumber(currentBalance)}).`,
    );
  }

  const activeLots = await lockActiveCustomerLots(tx, input.customerId);
  const plan = selectFifoAllocations(applyAmount, activeLots);
  const newBalance = roundMoney(new Big(currentBalance).minus(applyAmount).toNumber());

  await tx
    .update(customers)
    .set({ creditBalance: moneyString(newBalance) })
    .where(eq(customers.id, input.customerId));

  let runningBalance = currentBalance;
  const lotMap = new Map(activeLots.map((lot) => [lot.id, lot]));

  for (const chunk of plan) {
    const lot = lotMap.get(chunk.lotId)!;
    const nextRemaining = roundMoney(new Big(lot.remainingAmount).minus(chunk.amount).toNumber());
    const nextApplied = roundMoney(new Big(lot.appliedAmount).plus(chunk.amount).toNumber());
    runningBalance = roundMoney(new Big(runningBalance).minus(chunk.amount).toNumber());

    await tx
      .update(customerCreditLots)
      .set({
        remainingAmount: moneyString(nextRemaining),
        appliedAmount: moneyString(nextApplied),
      })
      .where(eq(customerCreditLots.id, lot.id));

    await tx.insert(customerCreditPaymentAllocations).values({
      id: createId(),
      paymentId: input.paymentId,
      creditLotId: lot.id,
      amount: moneyString(chunk.amount),
      status: "active",
    });

    await tx.insert(customerCreditMovements).values({
      id: createId(),
      customerId: input.customerId,
      creditLotId: lot.id,
      type: "applied",
      amount: moneyString(chunk.amount),
      signedDelta: moneyString(-chunk.amount),
      balanceAfter: moneyString(runningBalance),
      salesReturnId: lot.sourceReturnId,
      creditNoteNumber: lot.creditNoteNumber,
      invoiceId: input.invoiceId,
      paymentId: input.paymentId,
      notes: input.notes ?? "Applied store credit to invoice",
      performedById: input.performedById,
    });
  }

  return { balanceAfter: newBalance };
}

export async function restoreCustomerCreditForReversedPayment(
  tx: DbOrTx,
  input: {
    paymentId: string;
    invoiceId: string;
    customerId: string;
    performedById: string;
    reason: string;
  },
) {
  const customer = await lockCustomerRow(tx, input.customerId);
  const allocations = await tx
    .select()
    .from(customerCreditPaymentAllocations)
    .where(
      and(
        eq(customerCreditPaymentAllocations.paymentId, input.paymentId),
        eq(customerCreditPaymentAllocations.status, "active"),
      ),
    )
    .for("update");

  if (allocations.length === 0) return;

  const lotIds = allocations.map((a) => a.creditLotId);
  const lots = await tx
    .select()
    .from(customerCreditLots)
    .where(inArray(customerCreditLots.id, lotIds))
    .for("update");
  const lotMap = new Map(lots.map((l) => [l.id, l]));
  const now = new Date();
  let runningBalance = roundMoney(customer.creditBalance);

  for (const alloc of allocations) {
    const lot = lotMap.get(alloc.creditLotId);
    if (!lot) throw new Error("Linked customer credit lot not found");
    if (lot.voidedAt) {
      throw new Error("Cannot restore store credit from a voided credit note.");
    }
    const chunk = roundMoney(alloc.amount);
    const nextApplied = roundMoney(new Big(lot.appliedAmount).minus(chunk).toNumber());
    const nextRemaining = roundMoney(new Big(lot.remainingAmount).plus(chunk).toNumber());
    runningBalance = roundMoney(new Big(runningBalance).plus(chunk).toNumber());

    await tx
      .update(customerCreditPaymentAllocations)
      .set({ status: "reversed", reversedAt: now })
      .where(eq(customerCreditPaymentAllocations.id, alloc.id));

    await tx
      .update(customerCreditLots)
      .set({
        appliedAmount: moneyString(nextApplied),
        remainingAmount: moneyString(nextRemaining),
      })
      .where(eq(customerCreditLots.id, lot.id));

    await tx.insert(customerCreditMovements).values({
      id: createId(),
      customerId: input.customerId,
      creditLotId: lot.id,
      type: "application_reversed",
      amount: moneyString(chunk),
      signedDelta: moneyString(chunk),
      balanceAfter: moneyString(runningBalance),
      salesReturnId: lot.sourceReturnId,
      creditNoteNumber: lot.creditNoteNumber,
      invoiceId: input.invoiceId,
      paymentId: input.paymentId,
      notes: input.reason,
      performedById: input.performedById,
    });
  }

  await tx
    .update(customers)
    .set({ creditBalance: moneyString(runningBalance) })
    .where(eq(customers.id, input.customerId));
}

export async function issueCustomerRefund(
  tx: DbOrTx,
  input: {
    customerId: string;
    amount: number;
    walletId: string;
    refundDate: Date;
    notes?: string;
    salesReturnId?: string;
    allowOverdraw?: boolean;
    performedById: string;
    permissions: string[];
  },
) {
  const refundAmount = roundMoney(input.amount);
  if (refundAmount <= 0) throw new Error("Refund amount must be greater than zero");

  const customer = await lockCustomerRow(tx, input.customerId);
  const currentBalance = roundMoney(customer.creditBalance);
  if (refundAmount > currentBalance) {
    throw new Error(
      `Refund amount (Rs ${formatPakistaniNumber(refundAmount)}) exceeds available credit (Rs ${formatPakistaniNumber(currentBalance)}).`,
    );
  }

  await tx.select({ id: wallets.id }).from(wallets).where(eq(wallets.id, input.walletId)).for("update");
  const wallet = await tx.query.wallets.findFirst({
    where: eq(wallets.id, input.walletId),
    columns: { id: true, name: true, balance: true, type: true },
  });
  if (!wallet) throw new Error("Selected account not found");

  const nextWalletBalance = new Big(wallet.balance).minus(refundAmount);
  if (nextWalletBalance.lt(0)) {
    const canOverdraw = hasPermission(input.permissions, "finance.manage");
    if (!canOverdraw) {
      throw new Error(
        `"${wallet.name}" only has Rs ${formatPakistaniNumber(roundMoney(wallet.balance))}. Pick a funded account or ask Finance to record a deposit first.`,
      );
    }
    if (!input.allowOverdraw) {
      throw overdrawError(wallet.name, nextWalletBalance.toFixed(2));
    }
  }

  let scopedReturn: { id: string; creditNoteNumber: string | null } | null = null;
  let candidateLots = await lockActiveCustomerLots(tx, input.customerId);

  if (input.salesReturnId) {
    const ret = await tx.query.salesReturns.findFirst({
      where: and(
        eq(salesReturns.id, input.salesReturnId),
        eq(salesReturns.customerId, input.customerId),
      ),
      columns: { id: true, creditNoteNumber: true, status: true },
    });
    if (!ret || ret.status !== "completed") {
      throw new Error("Completed return not found for customer refund");
    }
    scopedReturn = { id: ret.id, creditNoteNumber: ret.creditNoteNumber };
    candidateLots = candidateLots.filter((lot) => lot.sourceReturnId === ret.id);
    const returnAvailable = roundMoney(
      candidateLots.reduce((sum, lot) => sum + roundMoney(lot.remainingAmount), 0),
    );
    if (refundAmount > returnAvailable) {
      throw new Error(
        `Refund amount (Rs ${formatPakistaniNumber(refundAmount)}) exceeds remaining credit from this return (Rs ${formatPakistaniNumber(returnAvailable)}).`,
      );
    }
  }

  const plan = selectFifoAllocations(refundAmount, candidateLots);
  const newCustomerBalance = roundMoney(new Big(currentBalance).minus(refundAmount).toNumber());
  const refundId = createId();
  const walletTxId = createId();

  await tx
    .update(wallets)
    .set({ balance: nextWalletBalance.toFixed(2) })
    .where(eq(wallets.id, wallet.id));

  await tx.insert(transactions).values({
    id: walletTxId,
    walletId: wallet.id,
    type: "debit",
    amount: moneyString(refundAmount),
    source: "Customer Refund",
    referenceId: refundId,
    description: `${customer.name}${scopedReturn?.creditNoteNumber ? ` (${scopedReturn.creditNoteNumber})` : ""}${input.notes ? ` — ${input.notes}` : ""}`,
    effectiveDate: input.refundDate,
    performedById: input.performedById,
  });

  await tx.insert(customerRefunds).values({
    id: refundId,
    customerId: input.customerId,
    salesReturnId: scopedReturn?.id ?? null,
    creditNoteNumber: scopedReturn?.creditNoteNumber ?? null,
    walletId: wallet.id,
    walletTransactionId: walletTxId,
    amount: moneyString(refundAmount),
    refundDate: input.refundDate,
    notes: input.notes?.trim() || null,
    status: "active",
    issuedById: input.performedById,
  });

  await tx
    .update(customers)
    .set({ creditBalance: moneyString(newCustomerBalance) })
    .where(eq(customers.id, input.customerId));

  const lotMap = new Map(candidateLots.map((lot) => [lot.id, lot]));
  let runningBalance = currentBalance;

  for (const chunk of plan) {
    const lot = lotMap.get(chunk.lotId)!;
    const nextRemaining = roundMoney(new Big(lot.remainingAmount).minus(chunk.amount).toNumber());
    const nextRefunded = roundMoney(new Big(lot.refundedAmount).plus(chunk.amount).toNumber());
    runningBalance = roundMoney(new Big(runningBalance).minus(chunk.amount).toNumber());

    await tx
      .update(customerCreditLots)
      .set({
        remainingAmount: moneyString(nextRemaining),
        refundedAmount: moneyString(nextRefunded),
      })
      .where(eq(customerCreditLots.id, lot.id));

    await tx.insert(customerRefundAllocations).values({
      id: createId(),
      refundId,
      creditLotId: lot.id,
      amount: moneyString(chunk.amount),
      status: "active",
    });

    await tx.insert(customerCreditMovements).values({
      id: createId(),
      customerId: input.customerId,
      creditLotId: lot.id,
      type: "refunded",
      amount: moneyString(chunk.amount),
      signedDelta: moneyString(-chunk.amount),
      balanceAfter: moneyString(runningBalance),
      salesReturnId: lot.sourceReturnId,
      creditNoteNumber: lot.creditNoteNumber,
      refundId,
      walletId: wallet.id,
      notes: input.notes?.trim() || `Refunded from ${wallet.name}`,
      performedById: input.performedById,
    });
  }

  return {
    refundId,
    walletTransactionId: walletTxId,
    walletName: wallet.name,
    amount: refundAmount,
    balanceAfter: newCustomerBalance,
  };
}

export async function reverseCustomerRefund(
  tx: DbOrTx,
  input: {
    refundId: string;
    reason: string;
    performedById: string;
  },
) {
  const [refund] = await tx
    .select()
    .from(customerRefunds)
    .where(eq(customerRefunds.id, input.refundId))
    .for("update");
  if (!refund) throw new Error("Refund record not found");
  if (refund.status === "reversed") {
    throw new Error("This refund has already been reversed");
  }

  if (refund.salesReturnId) {
    const ret = await tx.query.salesReturns.findFirst({
      where: eq(salesReturns.id, refund.salesReturnId),
      columns: { status: true, returnNumber: true },
    });
    if (ret?.status === "voided") {
      throw new Error(`Return #${ret.returnNumber} is already voided`);
    }
  }

  const customer = await lockCustomerRow(tx, refund.customerId);
  await tx.select({ id: wallets.id }).from(wallets).where(eq(wallets.id, refund.walletId)).for("update");
  const wallet = await tx.query.wallets.findFirst({
    where: eq(wallets.id, refund.walletId),
    columns: { id: true, name: true, balance: true },
  });
  if (!wallet) throw new Error("Refund wallet not found");

  const refundAmount = roundMoney(refund.amount);
  const now = new Date();
  const reversalTxId = createId();

  await tx
    .update(wallets)
    .set({ balance: new Big(wallet.balance).plus(refundAmount).toFixed(2) })
    .where(eq(wallets.id, wallet.id));

  await tx.insert(transactions).values({
    id: reversalTxId,
    walletId: wallet.id,
    type: "credit",
    amount: moneyString(refundAmount),
    source: "Customer Refund Reversal",
    referenceId: refund.id,
    reversalOfTransactionId: refund.walletTransactionId,
    description: `Reversed refund for ${customer.name}: ${input.reason.trim()}`,
    effectiveDate: now,
    performedById: input.performedById,
  });

  await tx
    .update(customerRefunds)
    .set({
      status: "reversed",
      reversedById: input.performedById,
      reversedAt: now,
      reverseReason: input.reason.trim(),
      reversalTransactionId: reversalTxId,
    })
    .where(eq(customerRefunds.id, refund.id));

  const allocations = await tx
    .select()
    .from(customerRefundAllocations)
    .where(
      and(
        eq(customerRefundAllocations.refundId, refund.id),
        eq(customerRefundAllocations.status, "active"),
      ),
    )
    .for("update");

  const lotIds = allocations.map((a) => a.creditLotId);
  const lots =
    lotIds.length > 0
      ? await tx
          .select()
          .from(customerCreditLots)
          .where(inArray(customerCreditLots.id, lotIds))
          .for("update")
      : [];
  const lotMap = new Map(lots.map((l) => [l.id, l]));
  let runningBalance = roundMoney(customer.creditBalance);

  for (const alloc of allocations) {
    const lot = lotMap.get(alloc.creditLotId);
    if (!lot) throw new Error("Linked customer credit lot not found");
    if (lot.voidedAt) {
      throw new Error("Cannot reverse refund for a voided credit note lot.");
    }
    const chunk = roundMoney(alloc.amount);
    const nextRefunded = roundMoney(new Big(lot.refundedAmount).minus(chunk).toNumber());
    const nextRemaining = roundMoney(new Big(lot.remainingAmount).plus(chunk).toNumber());
    runningBalance = roundMoney(new Big(runningBalance).plus(chunk).toNumber());

    await tx
      .update(customerRefundAllocations)
      .set({ status: "reversed", reversedAt: now })
      .where(eq(customerRefundAllocations.id, alloc.id));

    await tx
      .update(customerCreditLots)
      .set({
        refundedAmount: moneyString(nextRefunded),
        remainingAmount: moneyString(nextRemaining),
      })
      .where(eq(customerCreditLots.id, lot.id));

    await tx.insert(customerCreditMovements).values({
      id: createId(),
      customerId: refund.customerId,
      creditLotId: lot.id,
      type: "refund_reversed",
      amount: moneyString(chunk),
      signedDelta: moneyString(chunk),
      balanceAfter: moneyString(runningBalance),
      salesReturnId: lot.sourceReturnId,
      creditNoteNumber: lot.creditNoteNumber,
      refundId: refund.id,
      walletId: wallet.id,
      notes: input.reason.trim(),
      performedById: input.performedById,
    });
  }

  await tx
    .update(customers)
    .set({ creditBalance: moneyString(runningBalance) })
    .where(eq(customers.id, refund.customerId));

  return { refundId: refund.id, balanceAfter: runningBalance };
}

async function unapplyAllocationsFromVoidingLots(
  tx: DbOrTx,
  params: {
    customerId: string;
    voidingLots: Array<typeof customerCreditLots.$inferSelect>;
    reason: string;
    performedById: string;
    currentCreditBalance: number;
    recalculateInvoice: (invoiceId: string) => Promise<void>;
    recordTimeline: (params: {
      invoiceId: string;
      eventType: string;
      title: string;
      description: string;
      metadata: Record<string, unknown>;
      actorId: string;
    }) => Promise<void>;
  },
) {
  const lotIds = params.voidingLots.map((l) => l.id);
  if (lotIds.length === 0) return;

  const allocRows = await tx
    .select()
    .from(customerCreditPaymentAllocations)
    .where(
      and(
        inArray(customerCreditPaymentAllocations.creditLotId, lotIds),
        eq(customerCreditPaymentAllocations.status, "active"),
      ),
    )
    .for("update");

  if (allocRows.length === 0) return;

  const affectedPaymentIds = [...new Set(allocRows.map((a) => a.paymentId))];
  const paymentRows = await tx
    .select()
    .from(payments)
    .where(inArray(payments.id, affectedPaymentIds))
    .orderBy(asc(payments.invoiceId), asc(payments.id))
    .for("update");

  const affectedInvoiceIds = [...new Set(paymentRows.map((p) => p.invoiceId))].sort();
  await tx
    .select({ id: invoices.id })
    .from(invoices)
    .where(inArray(invoices.id, affectedInvoiceIds))
    .orderBy(asc(invoices.id))
    .for("update");

  const invoiceNumbers = await tx.query.invoices.findMany({
    where: inArray(invoices.id, affectedInvoiceIds),
    columns: { id: true, invoiceNumber: true },
  });
  const invoiceNumberMap = new Map(invoiceNumbers.map((inv) => [inv.id, inv.invoiceNumber]));
  const lotSet = new Set(lotIds);
  const lotMap = new Map(params.voidingLots.map((l) => [l.id, l]));
  const now = new Date();

  for (const payment of paymentRows) {
    const allPaymentAllocs = await tx
      .select()
      .from(customerCreditPaymentAllocations)
      .where(
        and(
          eq(customerCreditPaymentAllocations.paymentId, payment.id),
          eq(customerCreditPaymentAllocations.status, "active"),
        ),
      )
      .for("update");

    const voidingAllocs = allPaymentAllocs.filter((a) => lotSet.has(a.creditLotId));
    const keepingAllocs = allPaymentAllocs.filter((a) => !lotSet.has(a.creditLotId));
    if (voidingAllocs.length === 0) continue;

    await tx
      .update(payments)
      .set({
        status: "reversed",
        resolvedById: params.performedById,
        resolvedAt: now,
        resolutionReason: `Credit note voided: ${params.reason}`,
      })
      .where(eq(payments.id, payment.id));

    for (const vAlloc of voidingAllocs) {
      await tx
        .update(customerCreditPaymentAllocations)
        .set({ status: "reversed", reversedAt: now })
        .where(eq(customerCreditPaymentAllocations.id, vAlloc.id));

      const lot = lotMap.get(vAlloc.creditLotId)!;
      await tx.insert(customerCreditMovements).values({
        id: createId(),
        customerId: params.customerId,
        creditLotId: lot.id,
        type: "void_unapplied",
        amount: vAlloc.amount,
        signedDelta: "0.00",
        balanceAfter: moneyString(params.currentCreditBalance),
        salesReturnId: lot.sourceReturnId,
        creditNoteNumber: lot.creditNoteNumber,
        invoiceId: payment.invoiceId,
        paymentId: payment.id,
        notes: `Removed from Invoice ${invoiceNumberMap.get(payment.invoiceId) ?? payment.invoiceId}: ${params.reason}`,
        performedById: params.performedById,
      });
    }

    if (keepingAllocs.length > 0) {
      const preservedSum = roundMoney(
        keepingAllocs.reduce((sum, a) => sum + roundMoney(a.amount), 0),
      );
      const replacementPaymentId = createId();
      await tx.insert(payments).values({
        id: replacementPaymentId,
        customerId: payment.customerId,
        invoiceId: payment.invoiceId,
        amount: moneyString(preservedSum),
        method: "customer_credit",
        status: "confirmed",
        walletId: null,
        reference: payment.reference,
        recordedById: params.performedById,
        paymentDate: payment.paymentDate,
        effectiveDate: payment.effectiveDate ?? now,
        source: payment.source,
        sourceRecordId: null,
        allocationGroupId: payment.allocationGroupId,
        confirmedById: params.performedById,
        confirmedAt: now,
        notes: payment.notes ?? "Remaining active store credit allocation after void",
      });

      await tx
        .update(customerCreditPaymentAllocations)
        .set({ paymentId: replacementPaymentId })
        .where(
          inArray(
            customerCreditPaymentAllocations.id,
            keepingAllocs.map((a) => a.id),
          ),
        );
    }

    const removedTotal = roundMoney(
      voidingAllocs.reduce((sum, a) => sum + roundMoney(a.amount), 0),
    );
    await params.recordTimeline({
      invoiceId: payment.invoiceId,
      eventType: "payment",
      title: `Store credit payment reversed (${formatPakistaniNumber(removedTotal)})`,
      description: `Store credit of PKR ${removedTotal.toFixed(2)} was removed because the source return was voided (${params.reason}).`,
      metadata: { paymentId: payment.id, removedAmount: removedTotal, reason: params.reason },
      actorId: params.performedById,
    });
  }

  for (const invId of affectedInvoiceIds) {
    await params.recalculateInvoice(invId);
  }
}

export async function reclaimPaymentOverageCredit(
  tx: DbOrTx,
  input: {
    invoiceId: string;
    customerId: string;
    reclaimAmount: number;
    reason: string;
    performedById: string;
    allowUnapplyApplied: boolean;
    recalculateInvoice: (invoiceId: string) => Promise<void>;
    recordTimeline: (params: {
      invoiceId: string;
      eventType: string;
      title: string;
      description: string;
      metadata: Record<string, unknown>;
      actorId: string;
    }) => Promise<void>;
  },
): Promise<number> {
  const needed = roundMoney(input.reclaimAmount);
  if (needed <= 0) return 0;

  const customer = await lockCustomerRow(tx, input.customerId);
  const lots = await tx
    .select()
    .from(customerCreditLots)
    .where(
      and(
        eq(customerCreditLots.sourceInvoiceId, input.invoiceId),
        eq(customerCreditLots.sourceType, "payment_overage"),
        isNull(customerCreditLots.voidedAt),
      ),
    )
    .orderBy(desc(customerCreditLots.createdAt), desc(customerCreditLots.id))
    .for("update");

  let leftToReclaim = new Big(needed);
  let runningBalance = roundMoney(customer.creditBalance);

  // Check if refunded cash blocks reclaim
  const totalRefunded = roundMoney(
    lots.reduce((sum, lot) => sum + roundMoney(lot.refundedAmount), 0),
  );
  const totalReclaimableCapacity = roundMoney(
    lots.reduce(
      (sum, lot) =>
        sum +
        roundMoney(lot.remainingAmount) +
        (input.allowUnapplyApplied ? roundMoney(lot.appliedAmount) : 0),
      0,
    ),
  );

  if (totalReclaimableCapacity < needed) {
    if (totalRefunded > 0) {
      throw formatVoidBlockedByRefundError({
        refundedAmount: totalRefunded,
        customerId: customer.id,
        customerName: customer.name,
        customerType: customer.customerType,
      });
    }
    throw new Error(
      `Cannot reverse payment: Rs ${formatPakistaniNumber(needed)} of overpayment credit on this invoice was already applied or refunded.`,
    );
  }

  const lotsNeedingUnapply: Array<{ lot: typeof customerCreditLots.$inferSelect; takeApplied: number }> = [];

  for (const lot of lots) {
    if (leftToReclaim.lte(0)) break;
    const rem = new Big(roundMoney(lot.remainingAmount));
    const takeRem = rem.lt(leftToReclaim) ? rem : leftToReclaim;
    if (takeRem.gt(0)) {
      const amt = roundMoney(takeRem.toNumber());
      runningBalance = roundMoney(new Big(runningBalance).minus(amt).toNumber());
      await tx
        .update(customerCreditLots)
        .set({
          remainingAmount: moneyString(roundMoney(rem.minus(takeRem).toNumber())),
          reclaimedAmount: moneyString(roundMoney(new Big(lot.reclaimedAmount).plus(takeRem).toNumber())),
        })
        .where(eq(customerCreditLots.id, lot.id));

      await tx.insert(customerCreditMovements).values({
        id: createId(),
        customerId: input.customerId,
        creditLotId: lot.id,
        type: "void_reclaimed",
        amount: moneyString(amt),
        signedDelta: moneyString(-amt),
        balanceAfter: moneyString(runningBalance),
        invoiceId: input.invoiceId,
        notes: input.reason,
        performedById: input.performedById,
      });
      leftToReclaim = leftToReclaim.minus(takeRem);
    }

    if (leftToReclaim.gt(0) && input.allowUnapplyApplied && new Big(lot.appliedAmount).gt(0)) {
      const takeApplied = new Big(lot.appliedAmount).lt(leftToReclaim)
        ? new Big(lot.appliedAmount)
        : leftToReclaim;
      lotsNeedingUnapply.push({ lot, takeApplied: roundMoney(takeApplied.toNumber()) });
      leftToReclaim = leftToReclaim.minus(takeApplied);
    }
  }

  await tx
    .update(customers)
    .set({ creditBalance: moneyString(runningBalance) })
    .where(eq(customers.id, input.customerId));

  if (lotsNeedingUnapply.length > 0) {
    await unapplyAllocationsFromVoidingLots(tx, {
      customerId: input.customerId,
      voidingLots: lotsNeedingUnapply.map((entry) => entry.lot),
      reason: input.reason,
      performedById: input.performedById,
      currentCreditBalance: runningBalance,
      recalculateInvoice: input.recalculateInvoice,
      recordTimeline: input.recordTimeline,
    });
    for (const { lot, takeApplied } of lotsNeedingUnapply) {
      const appliedNum = roundMoney(lot.appliedAmount);
      const surplusReturned = roundMoney(Math.max(0, appliedNum - takeApplied));
      runningBalance = roundMoney(new Big(runningBalance).plus(surplusReturned).toNumber());
      await tx
        .update(customerCreditLots)
        .set({
          appliedAmount: "0.00",
          reclaimedAmount: moneyString(roundMoney(new Big(lot.reclaimedAmount).plus(takeApplied).toNumber())),
          remainingAmount: moneyString(surplusReturned),
          voidedAt: surplusReturned > 0 ? null : new Date(),
        })
        .where(eq(customerCreditLots.id, lot.id));

      // Ruling P2: When surplusReturned > 0 restores unused excess back onto customers.creditBalance,
      // insert an "application_reversed" movement row in customerCreditMovements for surplusReturned (signedDelta positive)
      // so the ledger invariant SUM(customer_credit_movements.signedDelta) === customers.creditBalance holds strictly.
      if (surplusReturned > 0) {
        await tx.insert(customerCreditMovements).values({
          id: createId(),
          customerId: input.customerId,
          creditLotId: lot.id,
          type: "application_reversed",
          amount: moneyString(surplusReturned),
          signedDelta: moneyString(surplusReturned),
          balanceAfter: moneyString(runningBalance),
          invoiceId: input.invoiceId,
          notes: `Restored un-reclaimed store credit allocation: ${input.reason}`,
          performedById: input.performedById,
        });
      }
    }
    await tx
      .update(customers)
      .set({ creditBalance: moneyString(runningBalance) })
      .where(eq(customers.id, input.customerId));
  }

  return needed;
}

export async function reclaimInvoiceReturnCreditForPaymentReversal(
  tx: DbOrTx,
  input: {
    invoiceId: string;
    customerId: string;
    reopenNeeded: number;
    performedById: string;
  },
) {
  const needed = roundMoney(input.reopenNeeded);
  if (needed <= 0) return;

  const customer = await lockCustomerRow(tx, input.customerId);

  const returnLots = await tx
    .select()
    .from(customerCreditLots)
    .where(
      and(
        eq(customerCreditLots.sourceInvoiceId, input.invoiceId),
        eq(customerCreditLots.sourceType, "sales_return"),
        isNull(customerCreditLots.voidedAt),
      ),
    )
    .orderBy(desc(customerCreditLots.createdAt), desc(customerCreditLots.id))
    .for("update");

  if (returnLots.length === 0) return;

  const totalRemaining = roundMoney(
    returnLots.reduce((sum, l) => sum + roundMoney(l.remainingAmount), 0),
  );
  const totalCustomerCreditFromReturns = roundMoney(
    returnLots.reduce((sum, l) => sum + roundMoney(l.originalAmount), 0),
  );
  const pullTarget = roundMoney(Math.min(needed, totalCustomerCreditFromReturns));

  if (pullTarget > totalRemaining) {
    throw new Error(
      "Cannot reverse payment: store credit generated after returns on this invoice has already been applied or refunded. Reverse the refund or credit application first.",
    );
  }

  let left = new Big(pullTarget);
  let runningBalance = roundMoney(customer.creditBalance);

  for (const lot of returnLots) {
    if (left.lte(0)) break;
    const rem = new Big(roundMoney(lot.remainingAmount));
    if (rem.lte(0)) continue;
    const take = rem.lt(left) ? rem : left;
    const takeNum = roundMoney(take.toNumber());
    runningBalance = roundMoney(new Big(runningBalance).minus(takeNum).toNumber());

    await tx
      .update(customerCreditLots)
      .set({
        remainingAmount: moneyString(roundMoney(rem.minus(take).toNumber())),
        reclaimedAmount: moneyString(roundMoney(new Big(lot.reclaimedAmount).plus(take).toNumber())),
      })
      .where(eq(customerCreditLots.id, lot.id));

    if (lot.sourceReturnId) {
      const ret = await tx.query.salesReturns.findFirst({
        where: eq(salesReturns.id, lot.sourceReturnId),
        columns: { id: true, appliedToInvoiceAmount: true, customerCreditAmount: true },
      });
      if (ret) {
        await tx
          .update(salesReturns)
          .set({
            appliedToInvoiceAmount: moneyString(
              roundMoney(new Big(ret.appliedToInvoiceAmount).plus(takeNum).toNumber()),
            ),
            customerCreditAmount: moneyString(
              roundMoney(Math.max(0, new Big(ret.customerCreditAmount).minus(takeNum).toNumber())),
            ),
          })
          .where(eq(salesReturns.id, ret.id));
      }
    }

    await tx.insert(customerCreditMovements).values({
      id: createId(),
      customerId: input.customerId,
      creditLotId: lot.id,
      type: "void_reclaimed",
      amount: moneyString(takeNum),
      signedDelta: moneyString(-takeNum),
      balanceAfter: moneyString(runningBalance),
      salesReturnId: lot.sourceReturnId,
      creditNoteNumber: lot.creditNoteNumber,
      invoiceId: input.invoiceId,
      notes: "Reclaimed unused return credit onto invoice after payment reversal",
      performedById: input.performedById,
    });

    left = left.minus(take);
  }

  await tx
    .update(customers)
    .set({ creditBalance: moneyString(runningBalance) })
    .where(eq(customers.id, input.customerId));
}

export async function voidReturnCreditSettlement(
  tx: DbOrTx,
  input: {
    salesReturnId: string;
    invoiceId: string;
    customerId: string;
    creditNoteNumber: string | null;
    reason: string;
    performedById: string;
    recalculateInvoice: (invoiceId: string) => Promise<void>;
    recordTimeline: (params: {
      invoiceId: string;
      eventType: string;
      title: string;
      description: string;
      metadata: Record<string, unknown>;
      actorId: string;
    }) => Promise<void>;
  },
) {
  const customer = await lockCustomerRow(tx, input.customerId);
  const lots = await tx
    .select()
    .from(customerCreditLots)
    .where(
      and(
        eq(customerCreditLots.sourceReturnId, input.salesReturnId),
        isNull(customerCreditLots.voidedAt),
      ),
    )
    .for("update");

  const refundedSum = roundMoney(
    lots.reduce((sum, lot) => sum + roundMoney(lot.refundedAmount), 0),
  );
  if (refundedSum > 0) {
    throw formatVoidBlockedByRefundError({
      refundedAmount: refundedSum,
      customerId: customer.id,
      customerName: customer.name,
      customerType: customer.customerType,
    });
  }

  let runningBalance = roundMoney(customer.creditBalance);
  const now = new Date();
  const appliedLots: Array<typeof customerCreditLots.$inferSelect> = [];

  for (const lot of lots) {
    const rem = roundMoney(lot.remainingAmount);
    if (rem > 0) {
      runningBalance = roundMoney(Math.max(0, new Big(runningBalance).minus(rem).toNumber()));
      await tx.insert(customerCreditMovements).values({
        id: createId(),
        customerId: input.customerId,
        creditLotId: lot.id,
        type: "void_reclaimed",
        amount: moneyString(rem),
        signedDelta: moneyString(-rem),
        balanceAfter: moneyString(runningBalance),
        salesReturnId: input.salesReturnId,
        creditNoteNumber: lot.creditNoteNumber,
        invoiceId: input.invoiceId,
        notes: `Reclaimed unused credit on void of ${lot.creditNoteNumber ?? input.salesReturnId}: ${input.reason}`,
        performedById: input.performedById,
      });
    }
    if (roundMoney(lot.appliedAmount) > 0) {
      appliedLots.push(lot);
    }
  }

  if (runningBalance !== roundMoney(customer.creditBalance)) {
    await tx
      .update(customers)
      .set({ creditBalance: moneyString(runningBalance) })
      .where(eq(customers.id, input.customerId));
  }

  if (appliedLots.length > 0) {
    await unapplyAllocationsFromVoidingLots(tx, {
      customerId: input.customerId,
      voidingLots: appliedLots,
      reason: input.reason,
      performedById: input.performedById,
      currentCreditBalance: runningBalance,
      recalculateInvoice: input.recalculateInvoice,
      recordTimeline: input.recordTimeline,
    });
  }

  if (lots.length > 0) {
    await tx
      .update(customerCreditLots)
      .set({ remainingAmount: "0.00", appliedAmount: "0.00", voidedAt: now })
      .where(inArray(customerCreditLots.id, lots.map((l) => l.id)));
  }
}

export async function getCustomerCreditSummary(db: DbOrTx, customerId: string) {
  await ensureCreditNotesBackfilled(db as typeof rootDb);

  const customer = await db.query.customers.findFirst({
    where: eq(customers.id, customerId),
    columns: { id: true, name: true, customerType: true, creditBalance: true, outstandingAmount: true },
  });
  if (!customer) throw new Error("Customer not found");

  const lotRows = await db.query.customerCreditLots.findMany({
    where: eq(customerCreditLots.customerId, customerId),
    orderBy: [desc(customerCreditLots.createdAt), desc(customerCreditLots.id)],
  });

  const lots = lotRows.map((lot) => {
    const remaining = roundMoney(lot.remainingAmount);
    const status: "voided" | "active" | "depleted" = lot.voidedAt
      ? "voided"
      : remaining > 0
        ? "active"
        : "depleted";
    return {
      id: lot.id,
      creditNoteNumber: lot.creditNoteNumber,
      sourceType: lot.sourceType,
      sourceReturnId: lot.sourceReturnId,
      sourceInvoiceId: lot.sourceInvoiceId,
      originalAmount: lot.originalAmount,
      remainingAmount: lot.remainingAmount,
      appliedAmount: lot.appliedAmount,
      refundedAmount: lot.refundedAmount,
      reclaimedAmount: lot.reclaimedAmount,
      voidedAt: lot.voidedAt,
      createdAt: lot.createdAt,
      notes: (lot as { notes?: string | null }).notes ?? null,
      status,
    };
  });

  const activeLotCount = lots.filter((l) => l.status === "active").length;

  const movements = await db.query.customerCreditMovements.findMany({
    where: eq(customerCreditMovements.customerId, customerId),
    with: {
      wallet: { columns: { id: true, name: true } },
      invoice: { columns: { id: true, invoiceNumber: true } },
      salesReturn: { columns: { id: true, returnNumber: true, creditNoteNumber: true, status: true } },
      refund: {
        columns: {
          id: true,
          status: true,
          refundDate: true,
          reverseReason: true,
          reversedAt: true,
          walletTransactionId: true,
        },
      },
      performedBy: { columns: { id: true, name: true } },
    },
    orderBy: [desc(customerCreditMovements.createdAt), desc(customerCreditMovements.id)],
    limit: 50,
  });

  const refunds = await db.query.customerRefunds.findMany({
    where: eq(customerRefunds.customerId, customerId),
    with: {
      wallet: { columns: { id: true, name: true, type: true } },
      issuedBy: { columns: { id: true, name: true } },
      reversedBy: { columns: { id: true, name: true } },
    },
    orderBy: [desc(customerRefunds.refundDate), desc(customerRefunds.createdAt)],
    limit: 50,
  });

  const creditNotes = await db.query.salesReturns.findMany({
    where: and(
      eq(salesReturns.customerId, customerId),
      sql`${salesReturns.creditNoteNumber} is not null`,
    ),
    columns: {
      id: true,
      returnNumber: true,
      creditNoteNumber: true,
      creditNoteIssuedAt: true,
      totalAmount: true,
      appliedToInvoiceAmount: true,
      customerCreditAmount: true,
      status: true,
      createdAt: true,
    },
    orderBy: [desc(salesReturns.creditNoteIssuedAt), desc(salesReturns.createdAt)],
    limit: 50,
  });

  const balance = roundMoney(customer.creditBalance);

  return {
    customerId: customer.id,
    customerName: customer.name,
    customerType: customer.customerType,
    balance,
    creditBalance: balance,
    outstandingAmount: roundMoney(customer.outstandingAmount),
    activeLotCount,
    lots,
    creditNotes: creditNotes.map((cn) => ({
      ...cn,
      totalAmount: roundMoney(cn.totalAmount),
      appliedToInvoiceAmount: roundMoney(cn.appliedToInvoiceAmount),
      customerCreditAmount: roundMoney(cn.customerCreditAmount),
    })),
    movements: movements.map((m) => ({
      ...m,
      type: m.type,
      movementType: m.type,
      amount: roundMoney(m.amount),
      signedDelta: roundMoney(m.signedDelta),
      balanceAfter: roundMoney(m.balanceAfter),
    })),
    refunds: refunds.map((r) => ({
      ...r,
      amount: roundMoney(r.amount),
    })),
  };
}

let backfillCompleted = false;

export async function ensureCreditNotesBackfilled(db: typeof rootDb): Promise<void> {
  if (backfillCompleted) return;
  if (typeof (db as { transaction?: unknown })?.transaction !== "function") return;

  const missingCountRows = await db
    .select({ id: salesReturns.id })
    .from(salesReturns)
    .where(and(inArray(salesReturns.status, ["completed", "voided"]), isNull(salesReturns.creditNoteNumber)))
    .limit(1);

  if (missingCountRows.length === 0) {
    backfillCompleted = true;
    return;
  }

  await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(salesReturns)
      .where(and(inArray(salesReturns.status, ["completed", "voided"]), isNull(salesReturns.creditNoteNumber)))
      .orderBy(asc(salesReturns.completedAt), asc(salesReturns.createdAt), asc(salesReturns.id))
      .for("update");

    for (const ret of rows) {
      const creditNoteNumber = await allocateNextCreditNoteNumber(tx);
      const [inv] = await tx
        .select()
        .from(invoices)
        .where(eq(invoices.id, ret.invoiceId))
        .for("update");

      const totalAmount = roundMoney(ret.totalAmount);
      if (!inv || ret.status === "voided") {
        await tx
          .update(salesReturns)
          .set({
            creditNoteNumber,
            creditNoteIssuedAt: ret.completedAt ?? ret.createdAt,
            appliedToInvoiceAmount: ret.status === "voided" ? moneyString(totalAmount) : "0.00",
            customerCreditAmount: "0.00",
          })
          .where(eq(salesReturns.id, ret.id));
        continue;
      }

      const priorReturns = await tx
        .select({ applied: salesReturns.appliedToInvoiceAmount })
        .from(salesReturns)
        .where(
          and(
            eq(salesReturns.invoiceId, inv.id),
            eq(salesReturns.status, "completed"),
            sql`${salesReturns.creditNoteNumber} is not null`,
          ),
        );
      const priorApplied = roundMoney(
        priorReturns.reduce((s, r) => s + roundMoney(r.applied), 0),
      );
      const preReturnOpen = roundMoney(
        Math.max(
          0,
          roundMoney(inv.totalPrice) -
            priorApplied -
            roundMoney(inv.paidAmount) +
            roundMoney(inv.excessCreditedAmount),
        ),
      );
      const split = computeReturnCreditSplit(totalAmount, preReturnOpen);
      const newReturnedTotal = roundMoney(priorApplied + split.appliedToInvoiceAmount);
      const nextOutstanding = roundMoney(
        Math.max(
          0,
          roundMoney(inv.totalPrice) -
            roundMoney(inv.paidAmount) -
            newReturnedTotal +
            roundMoney(inv.excessCreditedAmount),
        ),
      );

      await tx
        .update(salesReturns)
        .set({
          creditNoteNumber,
          creditNoteIssuedAt: ret.completedAt ?? ret.createdAt,
          appliedToInvoiceAmount: moneyString(split.appliedToInvoiceAmount),
          customerCreditAmount: moneyString(split.customerCreditAmount),
        })
        .where(eq(salesReturns.id, ret.id));

      await tx
        .update(invoices)
        .set({
          returnedAmount: moneyString(newReturnedTotal),
          outstandingAmount: moneyString(nextOutstanding),
          paymentStatus: nextOutstanding <= 0 ? "paid" : roundMoney(inv.paidAmount) > 0 ? "partially_paid" : "unpaid",
        })
        .where(eq(invoices.id, inv.id));

      await tx
        .update(slipRecords)
        .set({
          returnedAmount: moneyString(newReturnedTotal),
          outstandingAmount: moneyString(nextOutstanding),
          status: nextOutstanding <= 0 ? "closed" : roundMoney(inv.paidAmount) > 0 ? "partially_recovered" : "open",
        })
        .where(eq(slipRecords.invoiceId, inv.id));

      if (split.customerCreditAmount > 0) {
        await issueCustomerCreditFromReturn(tx, {
          customerId: ret.customerId,
          salesReturnId: ret.id,
          sourceInvoiceId: inv.id,
          creditNoteNumber,
          amount: split.customerCreditAmount,
          performedById: ret.receivedById ?? ret.createdById ?? inv.performedById,
          notes: `Backfilled store credit for ${creditNoteNumber}`,
        });
      }

      const [sumOutstanding] = await tx
        .select({ total: sql<string>`COALESCE(SUM(${invoices.outstandingAmount}), 0)` })
        .from(invoices)
        .where(and(eq(invoices.customerId, ret.customerId), sql`${invoices.status} <> 'voided'`));
      await tx
        .update(customers)
        .set({ outstandingAmount: moneyString(roundMoney(sumOutstanding?.total ?? 0)) })
        .where(eq(customers.id, ret.customerId));
    }
  });

  backfillCompleted = true;
}
