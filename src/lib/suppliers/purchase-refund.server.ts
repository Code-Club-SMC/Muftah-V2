import { eq, inArray } from "drizzle-orm";
import { supplierPayments, wallets } from "@/db";
import type { Tx } from "@/lib/inventory/material-lots.server";

/** A purchase's payments, plus which of the wallet ids they (or a chosen refund wallet) mention really exist. */
export async function loadPurchasePayments(tx: Tx, purchaseId: string, extraWalletIds: string[] = []) {
  const payments = await tx
    .select({ id: supplierPayments.id, amount: supplierPayments.amount, walletId: supplierPayments.walletId, method: supplierPayments.method })
    .from(supplierPayments)
    .where(eq(supplierPayments.purchaseId, purchaseId));
  const ids = [...new Set([...payments.flatMap((p) => [p.walletId, p.method]), ...extraWalletIds].filter((id): id is string => !!id))];
  const found = ids.length ? await tx.select({ id: wallets.id }).from(wallets).where(inArray(wallets.id, ids)) : [];
  return { payments, walletIds: new Set(found.map((w) => w.id)) };
}
