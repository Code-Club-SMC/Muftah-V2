import { ResponsiveSheet } from "../custom/responsive-sheet";
import { CreateRecipeForm } from "./create-recipe-from";
import { ChefHat } from "lucide-react";

type CreateRecipeSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const CreateRecipeSheet = ({
  open,
  onOpenChange,
}: CreateRecipeSheetProps) => {
  return (
    <ResponsiveSheet
      title="Create Packaging Format"
      description="Choose a mixing formula, container size, labels, and carton setup."
      open={open}
      onOpenChange={onOpenChange}
      icon={ChefHat}
    >
      <CreateRecipeForm onOpenChange={onOpenChange} />
    </ResponsiveSheet>
  );
};
