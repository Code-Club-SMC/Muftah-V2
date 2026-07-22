import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { AddUserForm } from "./add-user-form";
import { UserPlus } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const AddUserDialog = ({ open, onOpenChange }: Props) => {
  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Add New User"
      description="Create a new user account and assign a system role."
      className="sm:max-w-lg"
      icon={UserPlus}
    >
      <AddUserForm onSuccess={() => onOpenChange(false)} />
    </ResponsiveDialog>
  );
};