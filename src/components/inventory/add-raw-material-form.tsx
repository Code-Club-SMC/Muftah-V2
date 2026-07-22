import { useForm } from "@tanstack/react-form";
import { Loader2, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "../ui/field";
import { Input } from "../ui/input";
import { addChemicalSchema } from "@/lib/validators/validators";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { PaymentMethodSelect } from "@/components/suppliers/payment-method-select";
import { getInventoryFn } from "@/server-functions/inventory/get-inventory-fn";
import { useAddChemical } from "@/hooks/inventory/use-add-raw-material";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getSuppliersFn } from "@/server-functions/suppliers/get-suppliers-fn";
import { useMemo } from "react";
import { Textarea } from "../ui/textarea";
import { updatePurchaseRecordFn } from "@/server-functions/suppliers/update-purchase-record-fn";
import { toast } from "sonner";

export type ChemicalPurchaseInitialValues = {
  purchaseId: string;
  name: string;
  quantity: string;
  unitCost: string;
  paidAmount: string;
  minimumStockLevel: string;
  packagingType?: string;
  packagingSize?: string;
  unit: "kg" | "liters";
  notes?: string;
  invoiceNumber?: string;
  transactionId?: string;
  bankName?: string;
  paymentMethod?: string;
  paymentStatus?: "paid" | "partial" | "unpaid";
  supplierId?: string;
  warehouseId?: string;
};

type Props = {
  onSuccess: () => void;
  warehouses: Awaited<ReturnType<typeof getInventoryFn>>;
  preselectedWarehouse: string | undefined;
  preselectedSupplierId?: string;
  initialValues?: ChemicalPurchaseInitialValues;
};

export const AddRawMaterialForm = ({
  onSuccess,
  warehouses,
  preselectedWarehouse,
  preselectedSupplierId,
  initialValues,
}: Props) => {
  const isEditMode = !!initialValues?.purchaseId;
  const addMutate = useAddChemical();
  const queryClient = useQueryClient();

  const editMutate = useMutation({
    mutationFn: updatePurchaseRecordFn,
    onSuccess: () => {
      toast.success("Purchase record updated successfully");
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      onSuccess();
    },
    onError: (err: any) => toast.error(err.message || "Failed to update purchase record"),
  });

  const { data: suppliers } = useSuspenseQuery({
    queryKey: ["suppliers"],
    queryFn: getSuppliersFn,
  });

  const availableWarehouses = useMemo(
    () => warehouses.filter((w) => w.type === "factory_floor"),
    [warehouses],
  );

  const form = useForm({
    defaultValues: {
      name: initialValues?.name || "",
      warehouseId: initialValues?.warehouseId || preselectedWarehouse || availableWarehouses[0]?.id || "",
      quantity: initialValues?.quantity || "",
      packagingType: initialValues?.packagingType || "",
      packagingSize: initialValues?.packagingSize || "",
      costPerUnit: initialValues?.unitCost || "",
      unit: (initialValues?.unit || "kg") as "kg" | "liters",
      minimumStockLevel: initialValues?.minimumStockLevel || "0",
      supplierId: initialValues?.supplierId || preselectedSupplierId || "",
      notes: initialValues?.notes || "",
      invoiceNumber: initialValues?.invoiceNumber || "",
      paymentMethod: initialValues?.paymentMethod || "pay_later",
      paymentStatus: (initialValues?.paymentStatus || "unpaid") as "paid" | "partial" | "unpaid",
      walletId: "",
      amountPaid: initialValues?.paidAmount || "",
      transactionId: initialValues?.transactionId || "",
      bankName: initialValues?.bankName || "",
    },
    validators: isEditMode ? undefined : { onSubmit: addChemicalSchema },
    onSubmit: async ({ value }) => {
      if (isEditMode) {
        const totalCost = (parseFloat(value.costPerUnit) * parseFloat(value.quantity)).toFixed(2);
        await editMutate.mutateAsync({
          data: {
            id: initialValues!.purchaseId,
            quantity: value.quantity,
            cost: totalCost,
            notes: value.notes,
            invoiceNumber: value.invoiceNumber,
            transactionId: value.transactionId,
            materialName: value.name,
            minStock: value.minimumStockLevel,
            paymentStatus: value.paymentStatus,
            walletId: (value.paymentMethod !== "pay_later" && value.paymentMethod) ? value.paymentMethod : undefined,
            supplierName: suppliers?.find((s) => s.id === value.supplierId)?.supplierName,
          },
        });
      } else {
        await addMutate.mutateAsync({ data: value as any });
        onSuccess();
      }
    },
  });

  const isPreselectedInvalid =
    preselectedWarehouse && !availableWarehouses.find((w) => w.id === preselectedWarehouse);

  const isPending = isEditMode ? editMutate.isPending : addMutate.status === "pending";
  const originalPaid = parseFloat(initialValues?.paidAmount || "0");

  // Auto-derive paymentStatus from new total vs original paid amount
  const derivePaymentStatus = (newTotal: number): "paid" | "partial" | "unpaid" => {
    if (newTotal <= 0 || originalPaid <= 0) return "unpaid";
    if (originalPaid >= newTotal) return "paid";
    return "partial";
  };

  return (
    <form
      className="space-y-4 w-full"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
    >
      {isPreselectedInvalid && (
        <div className="p-3 rounded-lg bg-red-50 text-red-600 text-xs flex items-center gap-2">
          <Info className="size-4" />
          Selected facility is not a Factory Floor. Please select a valid facility.
        </div>
      )}

      <FieldGroup>
        {availableWarehouses.length === 0 && (
          <div className="p-3 rounded-lg bg-destructive/10 text-red-600 text-xs flex items-center gap-2">
            <Info className="size-4" />
            No Factory Floor configured. Please create one first.
          </div>
        )}

        <form.Field name="name">
          {(field) => (
            <Field>
              <FieldLabel>Chemical Name</FieldLabel>
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="e.g. Caustic Soda"
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        {!preselectedSupplierId && !isEditMode && (
          <form.Field name="supplierId">
            {(field) => (
              <Field>
                <FieldLabel>Supplier</FieldLabel>
                <Select value={field.state.value} onValueChange={(v) => field.handleChange(v)}>
                  <SelectTrigger><SelectValue placeholder="Select supplier" /></SelectTrigger>
                  <SelectContent>
                    {suppliers?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.supplierName}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
        )}

        <div className="grid grid-cols-2 gap-4">
          <form.Field name="packagingType">
            {(field) => (
              <Field>
                <FieldLabel>Packaging Type</FieldLabel>
                <Select value={field.state.value || ""} onValueChange={(val) => field.handleChange(val)}>
                  <SelectTrigger><SelectValue placeholder="Type" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Drum">Drum</SelectItem>
                    <SelectItem value="Bag">Bag</SelectItem>
                    <SelectItem value="Can">Can</SelectItem>
                    <SelectItem value="Box">Box</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
            )}
          </form.Field>

          <form.Field name="packagingSize">
            {(field) => (
              <Field>
                <FieldLabel>Packaging Size</FieldLabel>
                <Input
                  placeholder="e.g. 25kg, 200L"
                  value={field.state.value || ""}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </Field>
            )}
          </form.Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <form.Field name="quantity">
            {(field) => (
              <Field>
                <FieldLabel>Quantity</FieldLabel>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={field.state.value}
                  onChange={(e) => {
                    field.handleChange(e.target.value);
                    if (isEditMode) {
                      const qty = parseFloat(e.target.value || "0");
                      const cpu = parseFloat(form.state.values.costPerUnit || "0");
                      form.setFieldValue("paymentStatus", derivePaymentStatus(qty * cpu));
                    }
                  }}
                  min={0}
                  step={0.01}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="unit">
            {(field) => (
              <Field>
                <FieldLabel>Unit</FieldLabel>
                <Select
                  value={field.state.value}
                  onValueChange={(val) => field.handleChange(val as "kg" | "liters")}
                >
                  <SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kg">Kilograms (kg)</SelectItem>
                    <SelectItem value="liters">Liters (l)</SelectItem>
                  </SelectContent>
                </Select>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="costPerUnit">
            {(field) => (
              <Field>
                <FieldLabel>Cost Per Unit (PKR)</FieldLabel>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={field.state.value}
                  onChange={(e) => {
                    field.handleChange(e.target.value);
                    if (isEditMode) {
                      const cpu = parseFloat(e.target.value || "0");
                      const qty = parseFloat(form.state.values.quantity || "0");
                      form.setFieldValue("paymentStatus", derivePaymentStatus(qty * cpu));
                    }
                  }}
                  min={0}
                  step={0.01}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="minimumStockLevel">
            {(field) => (
              <Field>
                <FieldLabel>Min Stock Level</FieldLabel>
                <Input
                  type="number"
                  placeholder="0"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  min={0}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
        </div>

        {/* ─── LIVE TOTAL COST SUMMARY ─── */}
        <form.Subscribe
          selector={(state) => [state.values.costPerUnit, state.values.quantity]}
          children={([cost, qty]) => {
            const total = (parseFloat(cost || "0") || 0) * (parseFloat(qty || "0") || 0);
            if (total <= 0) return null;
            const pending = total - originalPaid;
            return (
              <div className={`rounded-lg border bg-muted/30 p-3 text-sm ${isEditMode ? "grid grid-cols-3 gap-3 text-center" : "flex items-center justify-between"}`}>
                {isEditMode ? (
                  <>
                    <div>
                      <p className="text-muted-foreground text-xs mb-0.5">Total</p>
                      <p className="font-semibold">PKR {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs mb-0.5">Paid</p>
                      <p className="font-semibold text-green-600">PKR {originalPaid.toLocaleString(undefined, { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground text-xs mb-0.5">Pending</p>
                      <p className={`font-semibold ${pending > 0 ? "text-red-500" : "text-green-600"}`}>
                        PKR {pending.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <span className="text-muted-foreground">Estimated Total Cost</span>
                    <span className="font-semibold text-primary">
                      PKR {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </>
                )}
              </div>
            );
          }}
        />

        <form.Field name="invoiceNumber">
          {(field) => (
            <Field>
              <FieldLabel>Invoice / Reference Number</FieldLabel>
              <Input
                placeholder="e.g. INV-123"
                value={field.state.value || ""}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <form.Field name="notes">
          {(field) => (
            <Field>
              <FieldLabel>Notes (Optional)</FieldLabel>
              <Textarea
                placeholder="Any additional details..."
                value={field.state.value || ""}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        {!isEditMode && <div className="grid grid-cols-2 gap-4">
          <form.Field name="paymentMethod">
            {(field) => (
              <Field>
                <FieldLabel>Payment Method</FieldLabel>
                <PaymentMethodSelect
                  value={field.state.value || "pay_later"}
                  onValueChange={(val) => {
                    field.handleChange(val);
                    if (val === "pay_later") {
                      form.setFieldValue("paymentStatus", "unpaid");
                      form.setFieldValue("amountPaid", "");
                    } else {
                      form.setFieldValue("paymentStatus", "paid");
                    }
                  }}
                  showBalance
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Subscribe
            selector={(state) => state.values.paymentMethod}
            children={(method) => (
              <form.Field name="paymentStatus">
                {(field) => (
                  <Field>
                    <FieldLabel>Payment Status</FieldLabel>
                    <Select
                      value={field.state.value}
                      onValueChange={(val: any) => field.handleChange(val)}
                      disabled={method === "pay_later"}
                    >
                      <SelectTrigger><SelectValue placeholder="Select status" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="paid">Paid Full</SelectItem>
                        <SelectItem value="partial">Credit / Partial</SelectItem>
                        <SelectItem value="unpaid">Unpaid</SelectItem>
                      </SelectContent>
                    </Select>
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
            )}
          />

          <form.Subscribe
            selector={(state) => [
              state.values.paymentStatus,
              state.values.costPerUnit,
              state.values.quantity,
              state.values.amountPaid,
              state.values.paymentMethod,
            ]}
            children={([status, cost, qty, paid, method]) => {
              if (method === "pay_later") return null;
              if (status !== "partial") return null;
              const total = (parseFloat(cost || "0") || 0) * (parseFloat(qty || "0") || 0);
              const paidAmount = parseFloat(paid || "0") || 0;
              const remaining = total - paidAmount;
              return (
                <div className="col-span-2 space-y-2">
                  <form.Field name="amountPaid">
                    {(field) => (
                      <Field>
                        <FieldLabel>Amount Paid <span className="text-red-500">*</span></FieldLabel>
                        <Input
                          type="number"
                          placeholder="0.00"
                          max={total > 0 ? total : undefined}
                          value={field.state.value || ""}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value || "0") || 0;
                            field.handleChange(total > 0 && val > total ? total.toString() : e.target.value);
                          }}
                        />
                        <FieldDescription>Running Total: PKR {total.toLocaleString()}</FieldDescription>
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>
                  <div className="text-sm font-medium border rounded-md p-3 bg-muted/30 flex justify-between items-center">
                    <span className="text-muted-foreground">Remaining Balance:</span>
                    <span className={remaining > 0 ? "text-red-500" : "text-green-600"}>
                      PKR {remaining.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                </div>
              );
            }}
          />

          <form.Subscribe
            selector={(state) => state.values.paymentMethod}
            children={(paymentMethod) => {
              if (paymentMethod !== "bank_transfer" && paymentMethod !== "cheque") return null;
              return (
                <div className="col-span-2 space-y-4 pt-2">
                  <form.Field name="bankName">
                    {(field) => (
                      <Field>
                        <FieldLabel>Bank Name</FieldLabel>
                        <Input
                          placeholder="e.g. HBL, Meezan, etc."
                          value={field.state.value || ""}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="transactionId">
                    {(field) => (
                      <Field>
                        <FieldLabel>Reference / Transaction ID</FieldLabel>
                        <Input
                          placeholder={paymentMethod === "cheque" ? "Cheque Number" : "Bank Transaction ID"}
                          value={field.state.value || ""}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>
                </div>
              );
            }}
          />
        </div>}

        <Button disabled={isPending} type="submit" className="w-full">
          {isPending ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : isEditMode ? (
            "Save Changes"
          ) : (
            "Add Chemical"
          )}
        </Button>
      </FieldGroup>
    </form>
  );
};
