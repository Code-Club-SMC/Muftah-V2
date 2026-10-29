import { useState } from "react";
import { getInventoryFn } from "@/server-functions/inventory/get-inventory-fn";
import { AddStockDialog } from "./add-stock-dialog";
import { restockRecord, SwitchToAddStock } from "./similar-material-warning";
import { ResponsiveDialog } from "../custom/responsive-dialog";
import { AddPackagingMaterialForm } from "./add-packaging-material-form";
import { PackagePlus } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouses: Awaited<ReturnType<typeof getInventoryFn>>;
  preselectedWarehouse: string | undefined;
  preselectedSupplierId?: string;
};

export const AddPackagingMaterialDialog = ({
  open,
  onOpenChange,
  warehouses,
  preselectedWarehouse,
  preselectedSupplierId,
}: Props) => {
  // "Add stock instead" from the similar-name warning swaps this form for the Add stock form.
  const [restock, setRestock] = useState<SwitchToAddStock | null>(null);
  const handleOpenChange = (next: boolean) => {
    if (!next) setRestock(null);
    onOpenChange(next);
  };
  return (
    <>
      <ResponsiveDialog
        title="Add Packaging Material"
        description="Add packaging materials to warehouse inventory"
        open={open && !restock}
        onOpenChange={handleOpenChange}
        icon={PackagePlus}
      >
        <AddPackagingMaterialForm
          onSuccess={() => onOpenChange(false)}
          onSwitchToAddStock={setRestock}
          warehouses={warehouses}
          preselectedWarehouse={preselectedWarehouse}
          preselectedSupplierId={preselectedSupplierId}
        />
      </ResponsiveDialog>
      {restock && (
        <AddStockDialog
          key={restock.materialId}
          open={open}
          onOpenChange={handleOpenChange}
          warehouses={warehouses}
          preselectedWarehouse={restock.warehouseId || preselectedWarehouse}
          itemToRestock={restockRecord(restock)}
          preselectedSupplierId={
            preselectedSupplierId || restock.supplierId || undefined
          }
        />
      )}
    </>
  );
};
