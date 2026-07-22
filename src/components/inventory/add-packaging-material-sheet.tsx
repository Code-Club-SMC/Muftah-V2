import { getInventoryFn } from "@/server-functions/inventory/get-inventory-fn";
import { ResponsiveSheet } from "../custom/responsive-sheet";
import { AddPackagingMaterialForm, PackagingPurchaseInitialValues } from "./add-packaging-material-form";
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
  const isEditMode = !!initialValues?.purchaseId;
  return (
    <ResponsiveSheet
      title={isEditMode ? "Edit Packaging Purchase" : "Add Packaging Material"}
      description={isEditMode ? "Update purchase record" : "Add packaging materials to warehouse inventory"}
      open={open}
      onOpenChange={onOpenChange}
      icon={PackagePlus}
    >
      <AddPackagingMaterialForm
        onSuccess={() => onOpenChange(false)}
        warehouses={warehouses}
        preselectedWarehouse={preselectedWarehouse}
        preselectedSupplierId={preselectedSupplierId}
        initialValues={initialValues}
      />
    </ResponsiveSheet>
  );
};
