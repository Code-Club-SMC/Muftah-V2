import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { AddSupplierForm } from "./add-supplier-form";
import { UserPlus } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const AddSupplierDialog = ({ open, onOpenChange }: Props) => {
  return (
    <ResponsiveSheet
      title="Add Supplier"
      description="Add a new supplier to your database."
      open={open}
      onOpenChange={onOpenChange}
      icon={UserPlus}
    >
      <AddSupplierForm onSuccess={() => onOpenChange(false)} />
    </ResponsiveSheet>
  );
};
