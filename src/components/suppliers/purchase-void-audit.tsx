import Big from "big.js";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";

export type PurchaseVoidMetadata = {
  voidedAt?: Date | string | null;
  voidedById?: string | null;
  voidedBy?: { name: string } | null;
  voidReason?: string | null;
  voidRefundAmount?: string | null;
  voidRefundWalletId?: string | null;
  voidRefundWallet?: { name: string } | null;
  voidSnapshot?: { materialName: string; unit: string; supplierName: string } | null;
};

/** Refunds belong to the whole purchase, not to an individual historical payment. */
export function PurchaseVoidAudit({ purchase }: { purchase: PurchaseVoidMetadata & { paidAmount: string } }) {
  if (!purchase.voidedAt) return null;
  const money = (amount: string) => `PKR ${Number(amount).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
  return <section aria-label="Purchase void audit" className="flex flex-col gap-3 rounded-md border p-4">
    <Badge variant="secondary">Voided</Badge>
    <p className="text-sm text-muted-foreground">Original amounts are retained for history. This purchase no longer counts towards stock or supplier debt.</p>
    <dl className="grid grid-cols-2 gap-2 text-sm">
      <dt>Voided on</dt><dd>{format(new Date(purchase.voidedAt), "PPP p")}</dd>
      <dt>Voided by</dt><dd>{purchase.voidedBy?.name ?? purchase.voidedById ?? "Unavailable"}</dd>
      <dt>Reason</dt><dd className="whitespace-pre-wrap break-words">{purchase.voidReason ?? "Unavailable"}</dd>
      <dt>Original purchase paid</dt><dd>{money(purchase.paidAmount)}</dd>
      <dt>Purchase refund</dt><dd>{money(purchase.voidRefundAmount ?? "0")}</dd>
      <dt>Not refunded</dt><dd>{money(new Big(purchase.paidAmount).minus(purchase.voidRefundAmount ?? "0").toFixed(2))}</dd>
      <dt>Refund wallet</dt><dd>{purchase.voidRefundWallet?.name ?? purchase.voidRefundWalletId ?? "No refund"}</dd>
      {purchase.voidSnapshot && <>
        <dt>Original supplier</dt><dd>{purchase.voidSnapshot.supplierName}</dd>
        <dt>Original material</dt><dd>{purchase.voidSnapshot.materialName}</dd>
        <dt>Original unit</dt><dd>{purchase.voidSnapshot.unit}</dd>
      </>}
    </dl>
  </section>;
}
