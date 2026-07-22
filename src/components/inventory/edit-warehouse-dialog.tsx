import { ResponsiveDialog } from "../custom/responsive-dialog";
import { EditWarehouseForm } from "./edit-warehouse-form";
import { Warehouse } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  warehouse: {
    id: string;
    name: string;
    address: string;
    city: string;
    state: string;
    type: "storage" | "factory_floor";
    latitude: string | number;
    longitude: string | number;
  };
};

export const EditWarehouseDialog = ({
  open,
  onOpenChange,
  warehouse,
}: Props) => {
  return (
    <ResponsiveDialog
      title="Edit Warehouse"
      description="Update the details of your warehouse."
      open={open}
      onOpenChange={onOpenChange}
      icon={Warehouse}
    >
      <EditWarehouseForm
        warehouse={warehouse}
        onSuccess={() => onOpenChange(false)}
      />
    </ResponsiveDialog>
  );
};
