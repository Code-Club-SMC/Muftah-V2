import Big from "big.js";

export type RefundPayment = { amount: string; walletId: string | null; method: string | null };

/**
 * Payments made when stock was bought only save the wallet in "method";
 * payments recorded later save it in "walletId". "pay_later" is not a wallet.
 */
function walletOf(payment: RefundPayment, walletIds: ReadonlySet<string>) {
  if (payment.walletId && walletIds.has(payment.walletId)) return payment.walletId;
  if (payment.method && walletIds.has(payment.method)) return payment.method;
  return null;
}

/**
 * What deleting a purchase gives back.
 *
 * Only payments that really came out of a wallet can be given back. By default
 * everything goes back to the wallet that paid most. The person can pick
 * another wallet or a smaller amount; whatever is not given back stays a loss.
 */
export function planPurchaseRefund(input: {
  payments: RefundPayment[];
  walletIds: ReadonlySet<string>;
  refundWalletId?: string | null;
  refundAmount?: string | null;
}) {
  const moved: { walletId: string; amount: Big }[] = [];
  for (const payment of input.payments) {
    const walletId = walletOf(payment, input.walletIds);
    const amount = new Big(payment.amount || "0");
    if (walletId && amount.gt(0)) moved.push({ walletId, amount });
  }

  const paid = moved.reduce((sum, row) => sum.plus(row.amount), new Big(0));
  const perWallet = new Map<string, Big>();
  for (const row of moved) perWallet.set(row.walletId, (perWallet.get(row.walletId) ?? new Big(0)).plus(row.amount));
  let defaultWalletId: string | null = null;
  let most = new Big(0);
  for (const [walletId, amount] of perWallet) {
    if (amount.gt(most)) {
      most = amount;
      defaultWalletId = walletId;
    }
  }

  if (paid.eq(0)) {
    return { moved, paid, defaultWalletId, refundWalletId: null, refund: new Big(0), loss: new Big(0) };
  }

  const requested = input.refundAmount?.trim();
  if (requested && !/^\d+(\.\d{1,2})?$/.test(requested)) throw new Error("Refund amount must be a number with at most 2 decimals");
  const refund = requested ? new Big(requested) : paid;
  if (refund.gt(paid)) throw new Error("Refund cannot be more than what was paid");

  const refundWalletId = input.refundWalletId || defaultWalletId;
  if (refund.gt(0)) {
    if (!refundWalletId || !input.walletIds.has(refundWalletId)) throw new Error("Pick the wallet to refund to");
  }

  return { moved, paid, defaultWalletId, refundWalletId: refund.gt(0) ? refundWalletId : null, refund, loss: paid.minus(refund) };
}
