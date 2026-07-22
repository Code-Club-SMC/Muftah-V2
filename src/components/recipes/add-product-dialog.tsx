import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAddProduct } from "@/hooks/inventory/use-add-product";
import { Package, AlignLeft } from "lucide-react";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export const AddProductDialog = ({ open, onOpenChange }: Props) => {
  const mutate = useAddProduct();

  const form = useForm({
    defaultValues: {
      name: "",
      description: "",
    },
    onSubmit: async ({ value }) => {
      await mutate.mutateAsync(
        {
          data: {
            name: value.name,
            description: value.description,
          },
        },
        {
          onSuccess: () => {
            onOpenChange(false);
            form.reset();
          },
        },
      );
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[450px]">
        <DialogHeader>
          <DialogTitle>Add New Product</DialogTitle>
          <DialogDescription>
            Register a new product in the system catalog to begin tracking its inventory and production.
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-6 pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          <div className="space-y-5">
            <form.Field name="name">
              {(field) => (
                <Field>
                  <FieldLabel className="flex items-center gap-2 mb-1.5">
                    <Package className="size-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Product Name</span>
                  </FieldLabel>
                  <Input
                    placeholder="e.g. Dish Wash Liquid (500ml)"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="bg-background"
                    autoFocus
                  />
                  <p className="text-[13px] text-muted-foreground mt-1.5">
                    The official name of the product as it will appear on invoices and reports.
                  </p>
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>

            <form.Field name="description">
              {(field) => (
                <Field>
                  <FieldLabel className="flex items-center gap-2 mb-1.5">
                    <AlignLeft className="size-4 text-muted-foreground" />
                    <span className="text-sm font-semibold">Description</span>
                  </FieldLabel>
                  <Textarea
                    placeholder="Optional details, variants, or packaging specifics..."
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    className="bg-background min-h-[100px] resize-none"
                  />
                  <p className="text-[13px] text-muted-foreground mt-1.5">
                    Any internal notes or specifications regarding this product.
                  </p>
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          </div>

          <div className="flex justify-end pt-4 border-t border-border/60">
            {/* Using form.Subscribe ensures the button re-renders correctly 
              during the TanStack Form submission state 
            */}
            <form.Subscribe selector={(s: any) => s.isSubmitting}>
              {(isSubmitting: boolean) => (
                <Button
                  disabled={isSubmitting}
                  type="submit"
                  className="w-full md:w-auto md:min-w-[140px]"
                >
                  {isSubmitting ? "Adding Product..." : "Add Product"}
                </Button>
              )}
            </form.Subscribe>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};