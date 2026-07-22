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
      title="Create Recipe"
      description="Define a production recipe with batch size, packaging, and formula details."
      open={open}
      onOpenChange={onOpenChange}
      icon={ChefHat}
    >
      <CreateRecipeForm onOpenChange={onOpenChange} />
    </ResponsiveSheet>
  );
};
