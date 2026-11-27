import { useQuery } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { getPurchaseEditStateFn } from "@/server-functions/suppliers/get-purchase-edit-state-fn";

/** Tells the person editing a partly used purchase what a new price will and will not change. */
export function UsedPurchaseNote({ purchaseId }: { purchaseId: string }) {
  const { data } = useQuery({
    queryKey: ["purchase-edit-state", purchaseId],
    queryFn: () => getPurchaseEditStateFn({ data: { id: purchaseId } }),
  });
  if (data?.activeReturn) {
    return (
      <p role="note" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
        <span>{data.activeReturn.message}</span>
      </p>
    );
  }
  if (!data?.stockLocked) return null;
  const unused = data.unused?.quantity ?? 0;
  return (
    <p role="note" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>
        {unused > 0
          ? `Some of this purchase is already used or moved, so its quantity can't change. If you change the price, the ${unused.toLocaleString("en-PK", { maximumFractionDigits: 3 })} ${data.unused?.unit} not used yet will take it. Batches already made keep their cost.`
          : "All of this purchase is already used, so its quantity can't change. A new price changes the bill. Batches already made keep their cost."}
      </span>
    </p>
  );
}
