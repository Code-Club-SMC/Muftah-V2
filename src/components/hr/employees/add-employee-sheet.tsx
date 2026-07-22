import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { AddEmployeeForm } from "./add-employee-form";
import { UserPlus } from "lucide-react";

export const AddEmployeeSheet = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  return (
    <ResponsiveSheet
      title="Add New Employee"
      description="Create a new employee profile. This will allow them to be assigned to shifts and processed in payroll."
      open={open}
      onOpenChange={onOpenChange}
      className="sm:max-w-xl"
      icon={UserPlus}
    >
      <AddEmployeeForm onSuccess={() => onOpenChange(false)} />
    </ResponsiveSheet>
  );
};
