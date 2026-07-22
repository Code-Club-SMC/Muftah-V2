import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { addPaymentFn } from "@/server-functions/suppliers/add-payment-fn";
import { toast } from "sonner";
import {
  Field,
  FieldGroup,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, CircleDollarSign } from "lucide-react";
import { z } from "zod";
import { useEffect } from "react";
import { PaymentMethodSelect } from "@/components/suppliers/payment-method-select";

const addPaymentSchema = z.object({
  supplierId: z.string(),
  purchaseId: z.string(),
  amount: z.string().min(1, "Amount is required"),
  walletId: z.string().min(1, "Payment method is required"),
  reference: z.string(),
  notes: z.string(),
});

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierId: string;
  supplierName: string;
  outstandingBalance: number;
  purchaseId?: string;
  defaultAmount?: string;
  defaultNotes?: string;
};

export const RecordPaymentDialog = ({
  open,
  onOpenChange,
  supplierId,
  supplierName,
  outstandingBalance,
  purchaseId,
  defaultAmount,
  defaultNotes,
}: Props) => {
  const queryClient = useQueryClient();

  const mutate = useMutation({
    mutationFn: addPaymentFn,
    onSuccess: () => {
      toast.success("Payment recorded successfully");
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      onOpenChange(false);
    },
  });

  const form = useForm({
    defaultValues: {
      supplierId: supplierId,
      purchaseId: purchaseId || "",
      amount: defaultAmount || "",
      walletId: "",
      reference: "",
      notes: defaultNotes || "",
    },
    validators: {
      onSubmit: addPaymentSchema,
    },
    onSubmit: async ({ value }) => {
      try {
        await mutate.mutateAsync({
          data: {
            ...value,
            paymentDate: new Date(),
          },
        });
      } catch (err: any) {
        // Map server error to the amount field
        form.setFieldMeta("amount", (prev) => ({
          ...prev,
          errorMap: {
            ...prev.errorMap,
            onSubmit: err.message || "Failed to record payment",
          },
        }));
      }
    },
  });

  useEffect(() => {
    if (open) {
      form.setFieldValue("amount", defaultAmount || "");
      form.setFieldValue("purchaseId", purchaseId || "");
      form.setFieldValue("supplierId", supplierId);
      form.setFieldValue("notes", defaultNotes || "");
    }
  }, [open, defaultAmount, defaultNotes, purchaseId, supplierId, form]);

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Record Payment"
      description={
        purchaseId
          ? `Record payment for this purchase. Remaining balance: PKR ${outstandingBalance.toLocaleString()}`
          : `Record a payment made to ${supplierName}. Current outstanding balance: PKR ${outstandingBalance.toLocaleString()}`
      }
      icon={CircleDollarSign}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="pt-2"
      >
        <FieldGroup>
          <form.Field
            name="amount"
            validators={{
              onChange: ({ value }) => {
                const numValue = parseFloat(value);
                if (isNaN(numValue) || numValue <= 0) {
                  return "Amount must be greater than 0";
                }
                if (numValue > outstandingBalance) {
                  return `Amount cannot exceed the outstanding balance of PKR ${outstandingBalance.toLocaleString()}`;
                }
                return undefined;
              },
            }}
          >
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel>Amount (PKR)</FieldLabel>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="walletId">
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel>Payment Method</FieldLabel>
                <PaymentMethodSelect
                  value={field.state.value}
                  onValueChange={(val) => field.handleChange(val)}
                  hidePayLater
                  showBalance
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="notes">
            {(field) => (
              <Field data-invalid={field.state.meta.errors.length > 0}>
                <FieldLabel>Notes (Optional)</FieldLabel>
                <Textarea
                  placeholder="Any additional notes..."
                  value={field.state.value || ""}
                  onChange={(e) => field.handleChange(e.target.value)}
                  onBlur={field.handleBlur}
                  aria-invalid={field.state.meta.errors.length > 0}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
        </FieldGroup>

        <div className="flex justify-end gap-2 pt-4">
          <Button
            variant="outline"
            type="button"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <form.Subscribe
            selector={(state) => [state.canSubmit, state.isSubmitting]}
          >
            {([canSubmit, isSubmitting]) => (
              <Button
                type="submit"
                disabled={!canSubmit || isSubmitting || mutate.isPending}
              >
                {(isSubmitting || mutate.isPending) && (
                  <Loader2 className="mr-2 size-4 animate-spin" />
                )}
                Record Payment
              </Button>
            )}
          </form.Subscribe>
        </div>
      </form>
    </ResponsiveDialog>
  );
};
