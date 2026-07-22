import { getInventoryFn } from "@/server-functions/inventory/get-inventory-fn";
import { ResponsiveSheet } from "../custom/responsive-sheet";
import { AddStockForm } from "./add-stock-dialog-form";
import { PackagePlus } from "lucide-react";

import { PurchaseRecord } from "@/components/suppliers/purchase-history-table";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouses: Awaited<ReturnType<typeof getInventoryFn>>;
  preselectedWarehouse: string | undefined;
  itemToRestock?: PurchaseRecord | null;
  preselectedSupplierId?: string;
};

export const AddStockDialog = ({
  open,
  onOpenChange,
  warehouses,
  preselectedWarehouse,
  itemToRestock,
  preselectedSupplierId,
}: Props) => {
  return (
    <ResponsiveSheet
      title={itemToRestock ? "Restock Material" : "Add Stock"}
      description={
        itemToRestock
          ? `Add more stock for ${itemToRestock.chemical?.name || itemToRestock.packagingMaterial?.name}`
          : "Add raw or packaging materials to warehouse inventory"
      }
      open={open}
      onOpenChange={onOpenChange}
      className="min-w-[600px]"
      icon={PackagePlus}
    >
      <AddStockForm
        onOpenChange={onOpenChange}
        warehouses={warehouses}
        onSuccess={() => onOpenChange(false)}
        preselectedWarehouse={preselectedWarehouse}
        itemToRestock={itemToRestock}
        preselectedSupplierId={preselectedSupplierId}
      />
    </ResponsiveSheet>
  );
};
