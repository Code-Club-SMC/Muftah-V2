import { useForm } from "@tanstack/react-form";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { useProductActions } from "@/hooks/inventory/use-product-actions";

type Product = {
  id: string;
  name: string;
  description: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product;
};

export const EditProductDialog = ({ open, onOpenChange, product }: Props) => {
  const { updateProduct } = useProductActions();

  const form = useForm({
    defaultValues: {
      name: product?.name || "",
      description: product?.description || "",
    },
    onSubmit: async ({ value }) => {
      await updateProduct.mutateAsync(
        {
          data: {
            id: product.id,
            name: value.name,
            description: value.description,
          },
        },
        {
          onSuccess: () => {
            onOpenChange(false);
          },
        },
      );
    },
  });

  if (!product) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Product</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            e.stopPropagation();
            form.handleSubmit();
          }}
        >
          <FieldGroup>
            <form.Field name="name">
              {(field) => (
                <Field>
                  <FieldLabel>Product Name</FieldLabel>
                  <Input
                    placeholder="e.g. Dish Wash Liquid"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>

            <form.Field name="description">
              {(field) => (
                <Field>
                  <FieldLabel>Description</FieldLabel>
                  <Textarea
                    placeholder="Optional description..."
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </Field>
              )}
            </form.Field>

            <Button
              disabled={form.state.isSubmitting}
              type="submit"
              className="w-full"
            >
              {form.state.isSubmitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                "Update Product"
              )}
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
};
