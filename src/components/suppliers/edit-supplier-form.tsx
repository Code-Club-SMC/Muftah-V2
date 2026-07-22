import { useForm } from "@tanstack/react-form";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { updateSupplierFn } from "@/server-functions/suppliers/update-supplier-fn";
import { updateSupplierSchema } from "@/lib/validators";
import { Textarea } from "../ui/textarea";

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
  supplier: Supplier;
  onSuccess: () => void;
};

export const EditSupplierForm = ({ supplier, onSuccess }: Props) => {
  const queryClient = useQueryClient();

  const mutate = useMutation({
    mutationFn: updateSupplierFn,
    onSuccess: () => {
      toast.success("Supplier updated successfully");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["supplier", supplier.id] });
      onSuccess();
    },
    onError: (error) => {
      toast.error(error.message || "Failed to update supplier");
    },
  });

  const form = useForm({
    defaultValues: {
      id: supplier.id,
      supplierName: supplier.supplierName,
      supplierShopName: supplier.supplierShopName || "",
      email: supplier.email || "",
      nationalId: supplier.nationalId || "",
      phone: supplier.phone || "",
      address: supplier.address || "",
      city: supplier.city || "",
      state: supplier.state || "",
      notes: supplier.notes || "",
    } as any,
    validators: {
      onSubmit: updateSupplierSchema,
    },
    onSubmit: async ({ value }) => {
      await mutate.mutateAsync({ data: value });
    },
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
    >
      <FieldGroup>
        <div className="grid grid-cols-2 gap-4">
          <form.Field name="supplierName">
            {(field) => (
              <Field>
                <FieldLabel>Supplier Name</FieldLabel>
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="supplierShopName">
            {(field) => (
              <Field>
                <FieldLabel>Supplier Shop Name</FieldLabel>
                <Input
                  value={field.state.value || ""}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <form.Field name="email">
            {(field) => (
              <Field>
                <FieldLabel>Email (Optional)</FieldLabel>
                <Input
                  type="email"
                  value={field.state.value || ""}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="nationalId">
            {(field) => (
              <Field>
                <FieldLabel>National ID (Optional)</FieldLabel>
                <Input
                  type="text"
                  value={field.state.value || ""}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
        </div>

        <form.Field name="phone">
          {(field) => (
            <Field>
              <FieldLabel>Phone</FieldLabel>
              <Input
                value={field.state.value || ""}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <form.Field name="address">
          {(field) => (
            <Field>
              <FieldLabel>Address</FieldLabel>
              <Input
                value={field.state.value || ""}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <div className="grid grid-cols-2 gap-4">
          <form.Field name="city">
            {(field) => (
              <Field>
                <FieldLabel>City (Optional)</FieldLabel>
                <Input
                  value={field.state.value || ""}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="state">
            {(field) => (
              <Field>
                <FieldLabel>State (Optional)</FieldLabel>
                <Input
                  value={field.state.value || ""}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
        </div>

        <form.Field name="notes">
          {(field) => (
            <Field>
              <FieldLabel>Notes (Optional)</FieldLabel>
              <Textarea
                value={field.state.value || ""}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <Button
          type="submit"
          disabled={form.state.isSubmitting}
          className="w-full"
        >
          {form.state.isSubmitting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            "Update Supplier"
          )}
        </Button>
      </FieldGroup>
    </form>
  );
};
