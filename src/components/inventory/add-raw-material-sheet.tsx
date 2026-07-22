import { getInventoryFn } from "@/server-functions/inventory/get-inventory-fn";
import { AddRawMaterialForm, ChemicalPurchaseInitialValues } from "./add-raw-material-form";
import { ResponsiveSheet } from "../custom/responsive-sheet";
import { FlaskConical } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouses: Awaited<ReturnType<typeof getInventoryFn>>;
  preselectedWarehouse: string | undefined;
  preselectedSupplierId?: string;
  initialValues?: ChemicalPurchaseInitialValues;
};

export const AddRawMaterialDialog = ({
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
      title={isEditMode ? "Edit Chemical Purchase" : "Add Chemical"}
      description={isEditMode ? "Update purchase record" : "Add Chemicals to factory floor"}
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-2xl"
      icon={FlaskConical}
    >
      <AddRawMaterialForm
        onSuccess={() => onOpenChange(false)}
        warehouses={warehouses}
        preselectedWarehouse={preselectedWarehouse}
        preselectedSupplierId={preselectedSupplierId}
        initialValues={initialValues}
      />
    </ResponsiveSheet>
  );
};
