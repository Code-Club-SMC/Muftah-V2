import { useState } from "react";
import { getInventoryFn } from "@/server-functions/inventory/get-inventory-fn";
import { AddStockDialog } from "./add-stock-dialog";
import { restockRecord, SwitchToAddStock } from "./similar-material-warning";
import { ResponsiveSheet } from "../custom/responsive-sheet";
import {
  AddPackagingMaterialForm,
  PackagingPurchaseInitialValues,
} from "./add-packaging-material-form";
import { PackagePlus } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouses: Awaited<ReturnType<typeof getInventoryFn>>;
  preselectedWarehouse: string | undefined;
  preselectedSupplierId?: string;
  initialValues?: PackagingPurchaseInitialValues;
};

export const AddPackagingMaterialSheet = ({
  open,
  onOpenChange,
  warehouses,
  preselectedWarehouse,
  preselectedSupplierId,
  initialValues,
}: Props) => {
  // "Add stock instead" from the similar-name warning swaps this form for the Add stock form.
  const [restock, setRestock] = useState<SwitchToAddStock | null>(null);
  const handleOpenChange = (next: boolean) => {
    if (!next) setRestock(null);
    onOpenChange(next);
  };
  const isEditMode = !!initialValues?.purchaseId;
  return (
    <>
      <ResponsiveSheet
        title={
          isEditMode ? "Edit Packaging Purchase" : "Add Packaging Material"
        }
        description={
          isEditMode
            ? "Update purchase record"
            : "Add packaging materials to warehouse inventory"
        }
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
          initialValues={initialValues}
        />
      </ResponsiveSheet>
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
