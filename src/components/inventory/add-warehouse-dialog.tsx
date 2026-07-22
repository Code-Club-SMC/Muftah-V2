import { ResponsiveDialog } from "../custom/responsive-dialog";
import { AddWarehouseForm } from "./add-warehouse-form";
import { Warehouse } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  forcedType?: "storage" | "factory_floor";
};

export const AddWarehouseDialog = ({
  open,
  onOpenChange,
  forcedType,
}: Props) => {
  const title =
    forcedType === "factory_floor"
      ? "Add Factory Floor"
      : forcedType === "storage"
        ? "Add Warehouse"
        : "Add Facility";
  const description =
    forcedType === "factory_floor"
      ? "Create a new production facility to track chemicals and packaging materials."
      : "Create a new storage location for finished goods and returns.";

  return (
    <ResponsiveDialog
      title={title}
      description={description}
      open={open}
      onOpenChange={onOpenChange}
      icon={Warehouse}
    >
      <AddWarehouseForm
        onSuccess={() => onOpenChange(false)}
        forcedType={forcedType}
      />
    </ResponsiveDialog>
  );
};
