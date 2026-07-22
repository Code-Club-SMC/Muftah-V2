import { ResponsiveSheet } from "../custom/responsive-sheet";
import { CreateRecipeForm } from "./create-recipe-from";
import { getRecipesFn } from "@/server-functions/inventory/recipes/get-recipe-fn";
import { ChefHat } from "lucide-react";

type Recipe = Awaited<ReturnType<typeof getRecipesFn>>[number];

type CreateRecipeSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRecipe?: Recipe;
};

export const CreateRecipeSheet = ({
  open,
  onOpenChange,
  initialRecipe,
}: CreateRecipeSheetProps) => {
  return (
    <ResponsiveSheet
      title={initialRecipe ? "Edit Recipe" : "Create Recipe"}
      description={
        initialRecipe
          ? "Update the details of your production recipe."
          : "Define a production recipe with batch size, packaging, and formula details."
      }
      open={open}
      onOpenChange={onOpenChange}
      icon={ChefHat}
    >
      <CreateRecipeForm
        onOpenChange={onOpenChange}
        initialRecipe={initialRecipe}
      />
    </ResponsiveSheet>
  );
};
