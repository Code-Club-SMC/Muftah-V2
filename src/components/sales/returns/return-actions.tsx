import {
  ReturnLifecycleActions,
  type ReturnLifecycleItem,
} from "@/components/sales/return-lifecycle-actions";
import { getReturnUnitsPerCarton } from "@/lib/sales/returns/refund-pricing";
import { requestedUnits } from "@/lib/sales/returns/return-lifecycle";

type ReturnActionSourceItem = {
  id: string;
  cartonsRequested: number;
  quantityRequested: number;
  invoiceItem?: {
    pack?: string | null;
    packsPerCarton?: number | null;
    actualPackSize?: number | null;
  } | null;
};

export function toReturnLifecycleItems(items: ReturnActionSourceItem[]): ReturnLifecycleItem[] {
  return items.map((item) => ({
    id: item.id,
    label: item.invoiceItem?.pack ?? "Item",
    approvedUnits: requestedUnits(
      item,
      item.invoiceItem ? getReturnUnitsPerCarton(item.invoiceItem) : 1,
    ),
  }));
}

export function ReturnActions({
  salesReturn,
}: {
  salesReturn: {
    id: string;
    returnNumber?: number;
    invoiceId: string;
    status: string;
    items?: ReturnActionSourceItem[];
  };
}) {
  return (
    <ReturnLifecycleActions
      invoiceId={salesReturn.invoiceId}
      returnId={salesReturn.id}
      returnNumber={salesReturn.returnNumber}
      status={salesReturn.status}
      items={salesReturn.items ? toReturnLifecycleItems(salesReturn.items) : undefined}
    />
  );
}
