import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { EditSupplierForm } from "./edit-supplier-form";
import { UserRoundPen } from "lucide-react";

type Supplier = {
  id: string;
  supplierName: string;
  supplierShopName: string | null;
  email: string | null;
  nationalId: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  notes: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplier: Supplier;
};

export const EditSupplierDialog = ({ open, onOpenChange, supplier }: Props) => {
  return (
    <ResponsiveSheet
      title="Edit Supplier Profile"
      description="Update the supplier's information."
      open={open}
      onOpenChange={onOpenChange}
      icon={UserRoundPen}
    >
      <EditSupplierForm
        supplier={supplier}
        onSuccess={() => onOpenChange(false)}
      />
    </ResponsiveSheet>
  );
};
