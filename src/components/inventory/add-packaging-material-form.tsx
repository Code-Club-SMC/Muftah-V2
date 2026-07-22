import { useForm } from "@tanstack/react-form";
import { Loader2, Box, Package, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "../ui/field";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { PaymentMethodSelect } from "@/components/suppliers/payment-method-select";
import { getInventoryFn } from "@/server-functions/inventory/get-inventory-fn";
import { useAddPackagingMaterial } from "@/hooks/inventory/use-add-packaging-material";
import { addPackagingMaterialSchema } from "@/lib/validators/validators";
import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { getSuppliersFn } from "@/server-functions/suppliers/get-suppliers-fn";
import { Textarea } from "../ui/textarea";
import { updatePurchaseRecordFn } from "@/server-functions/suppliers/update-purchase-record-fn";
import { toast } from "sonner";

export type PackagingPurchaseInitialValues = {
  purchaseId: string;
  name: string;
  quantity: string;
  unitCost: string;
  paidAmount: string;
  minimumStockLevel: number;
  type: "primary" | "master" | "sticker" | "extra";
  capacity?: string;
  capacityUnit?: string;
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
  initialValues?: PackagingPurchaseInitialValues;
};

export const AddPackagingMaterialForm = ({
  onSuccess,
  warehouses,
  preselectedWarehouse,
  preselectedSupplierId,
  initialValues,
}: Props) => {
  const isEditMode = !!initialValues?.purchaseId;
  const addMutate = useAddPackagingMaterial();
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

  const initialType = (initialValues?.type as "primary" | "master" | "sticker") || "primary";
  const [activeType, setActiveType] = useState<"primary" | "master" | "sticker">(initialType);

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
      costPerUnit: initialValues?.unitCost || "",
      minimumStockLevel: initialValues?.minimumStockLevel ?? 0,
      type: (initialValues?.type || "primary") as "primary" | "master" | "sticker" | "extra",
      capacity: initialValues?.capacity || "",
      capacityUnit: initialValues?.capacityUnit || "",
      weightPerPack: "",
      pricePerKg: "",
      associatedStickerId: "",
      stickerCost: "",
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
    validators: isEditMode ? undefined : { onSubmit: addPackagingMaterialSchema },
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
            capacity: value.capacity,
            capacityUnit: value.capacityUnit,
            minStock: value.minimumStockLevel?.toString(),
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

  const derivePaymentStatus = (newTotal: number): "paid" | "partial" | "unpaid" => {
    if (newTotal <= 0 || originalPaid <= 0) return "unpaid";
    if (originalPaid >= newTotal) return "paid";
    return "partial";
  };

  return (
    <div className="space-y-4 w-full">
      {/* Type Switcher — hidden in edit mode since type can't change */}
      {!isEditMode && (
        <div className="grid grid-cols-3 gap-2 p-1 bg-muted rounded-lg border">
          <Button
            type="button"
            size="lg"
            onClick={() => {
              setActiveType("primary");
              form.setFieldValue("type", "primary");
              form.setFieldValue("capacityUnit", "ml");
            }}
            variant={activeType === "primary" ? "default" : "outline"}
          >
            <Package className={cn("size-3.5", activeType === "primary" ? "text-white" : "text-muted-foreground")} />
            Packing
          </Button>
          <Button
            size="lg"
            type="button"
            onClick={() => {
              setActiveType("master");
              form.setFieldValue("type", "master");
              form.setFieldValue("capacityUnit", "units");
            }}
            variant={activeType === "master" ? "default" : "outline"}
          >
            <Box className={cn("size-3.5", activeType === "master" ? "text-white" : "text-muted-foreground")} />
            Carton
          </Button>
          <Button
            size="lg"
            type="button"
            onClick={() => {
              setActiveType("sticker");
              form.setFieldValue("type", "sticker");
              form.setFieldValue("capacityUnit", "pcs");
            }}
            variant={activeType === "sticker" ? "default" : "outline"}
          >
            <Info className={cn("size-3.5", activeType === "sticker" ? "text-white" : "text-muted-foreground")} />
            Sticker
          </Button>
        </div>
      )}

      <form
        className="space-y-4"
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
                <FieldLabel>Material Name</FieldLabel>
                <Input
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder={
                    activeType === "primary" ? "e.g. 100g Pack"
                    : activeType === "master" ? "e.g. 10kg Bucket"
                    : "e.g. 10kg Bucket Sticker"
                  }
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

          {activeType !== "sticker" && (
            <div className="grid grid-cols-2 gap-4">
              <form.Field name="capacity">
                {(field) => (
                  <Field>
                    <FieldLabel>{activeType === "primary" ? "Fill Capacity" : "Units per Bucket"}</FieldLabel>
                    <Input
                      type="number"
                      value={field.state.value || ""}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder={activeType === "primary" ? "e.g. 500" : "e.g. 24"}
                    />
                    <FieldDescription>{activeType === "primary" ? "Net content volume." : "Units inside one bucket."}</FieldDescription>
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>

              <form.Field name="capacityUnit">
                {(field) => (
                  <Field>
                    <FieldLabel>{activeType === "primary" ? "Unit" : "Inner Item Content"}</FieldLabel>
                    {activeType === "primary" ? (
                      <Select value={field.state.value || "ml"} onValueChange={(val) => field.handleChange(val)}>
                        <SelectTrigger><SelectValue placeholder="Unit" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ml">ml (Volume)</SelectItem>
                          <SelectItem value="L">L (Volume)</SelectItem>
                          <SelectItem value="g">g (Mass)</SelectItem>
                          <SelectItem value="kg">kg (Mass)</SelectItem>
                          <SelectItem value="pcs">Pieces</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Input
                        value={field.state.value || ""}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="e.g. 1kg Bags"
                      />
                    )}
                    <FieldDescription>{activeType === "primary" ? "Volume/Mass unit." : "What is inside the bucket?"}</FieldDescription>
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
            </div>
          )}

          {activeType === "primary" && !isEditMode && (
            <div className="grid grid-cols-2 gap-4 border p-3 rounded-lg bg-muted/20">
              <form.Field name="weightPerPack">
                {(field) => (
                  <Field>
                    <FieldLabel>Weight / Pack (g)</FieldLabel>
                    <Input type="number" value={field.state.value || ""} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g. 6.5" />
                    <FieldDescription>Weight of the empty bottle/wrapper.</FieldDescription>
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
              <form.Field name="pricePerKg">
                {(field) => (
                  <Field>
                    <FieldLabel>Material Price / Kg (PKR)</FieldLabel>
                    <Input type="number" value={field.state.value || ""} onChange={(e) => field.handleChange(e.target.value)} placeholder="e.g. 980" />
                    <FieldDescription>Purchase price per kg of the material.</FieldDescription>
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
            </div>
          )}

          {!isEditMode && (
            <form.Subscribe
              selector={(state) => [state.values.weightPerPack, state.values.pricePerKg, state.values.type]}
              children={([weight, price, type]) => {
                if (type !== "primary" || !weight || !price) return null;
                const w = parseFloat(weight || "0");
                const p = parseFloat(price || "0");
                if (w <= 0 || p <= 0) return null;
                const exactCost = p * (w / 1000);
                const roundedCost = Math.round(exactCost);
                return (
                  <div className="flex flex-col gap-3 bg-primary/5 p-4 rounded-xl border border-primary/10 animate-in fade-in slide-in-from-top-2">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">The Golden Formula</div>
                        <div className="text-sm font-medium text-primary">
                          {w}g × {p} PKR/kg = <span className="text-lg font-bold">PKR {exactCost.toFixed(2)}</span>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button type="button" size="sm" variant="outline" className="h-8 text-xs font-semibold px-4" onClick={() => form.setFieldValue("costPerUnit", exactCost.toFixed(4))}>Apply Exact</Button>
                        <Button type="button" size="sm" className="h-8 text-xs font-semibold px-4 active:scale-95" onClick={() => form.setFieldValue("costPerUnit", roundedCost.toString())}>Apply Rounded ({roundedCost})</Button>
                      </div>
                    </div>
                    <p className="text-[10px] text-muted-foreground italic border-t pt-2 border-primary/5">
                      Matches the spreadsheet logic: {w}g is {(w / 1000).toFixed(3)}kg. Total = {(w / 1000).toFixed(3)} × {p} = {exactCost.toFixed(2)}.
                    </p>
                  </div>
                );
              }}
            />
          )}

          <div className="grid grid-cols-2 gap-4">
            <form.Field name="quantity">
              {(field) => (
                <Field>
                  <FieldLabel>{isEditMode ? "Quantity" : "Initial Stock"}</FieldLabel>
                  <Input
                    type="number"
                    value={field.state.value}
                    onChange={(e) => {
                      field.handleChange(e.target.value);
                      if (isEditMode) {
                        const qty = parseFloat(e.target.value || "0");
                        const cpu = parseFloat(form.state.values.costPerUnit || "0");
                        form.setFieldValue("paymentStatus", derivePaymentStatus(qty * cpu));
                      }
                    }}
                    placeholder="0"
                  />
                  {!isEditMode && <FieldDescription>Current physical count.</FieldDescription>}
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
                    value={field.state.value}
                    onChange={(e) => {
                      field.handleChange(e.target.value);
                      if (isEditMode) {
                        const cpu = parseFloat(e.target.value || "0");
                        const qty = parseFloat(form.state.values.quantity || "0");
                        form.setFieldValue("paymentStatus", derivePaymentStatus(qty * cpu));
                      }
                    }}
                    placeholder="0.00"
                    step="0.01"
                  />
                  {!isEditMode && <FieldDescription>Purchase price per item.</FieldDescription>}
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          </div>

          <form.Field name="minimumStockLevel">
            {(field) => (
              <Field>
                <FieldLabel>Min. Stock Alert</FieldLabel>
                <Input type="number" value={field.state.value} onChange={(e) => field.handleChange(Number(e.target.value))} placeholder="100" step="1" />
                <FieldDescription>Notify when stock falls below this level.</FieldDescription>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

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
                      <span className="font-semibold text-primary">PKR {total.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
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
                <Input placeholder="e.g. INV-123" value={field.state.value || ""} onChange={(e) => field.handleChange(e.target.value)} />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="notes">
            {(field) => (
              <Field>
                <FieldLabel>Notes (Optional)</FieldLabel>
                <Textarea placeholder="Any additional details..." value={field.state.value || ""} onChange={(e) => field.handleChange(e.target.value)} />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          {!isEditMode && <><form.Field name="paymentMethod">
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
                    <Select value={field.state.value} onValueChange={(val: any) => field.handleChange(val)} disabled={method === "pay_later"}>
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
            selector={(state) => [state.values.paymentStatus, state.values.costPerUnit, state.values.quantity, state.values.amountPaid, state.values.paymentMethod]}
            children={([status, cost, qty, paid, method]) => {
              if (method === "pay_later" || status !== "partial") return null;
              const total = (parseFloat(cost || "0") || 0) * (parseFloat(qty || "0") || 0);
              const paidAmount = parseFloat(paid || "0") || 0;
              const remaining = total - paidAmount;
              return (
                <div className="col-span-2 space-y-2">
                  <form.Field name="amountPaid">
                    {(field) => (
                      <Field>
                        <FieldLabel>Amount Paid <span className="text-red-500">*</span></FieldLabel>
                        <Input type="number" placeholder="0.00" max={total > 0 ? total : undefined} value={field.state.value || ""} onChange={(e) => {
                          const val = parseFloat(e.target.value || "0") || 0;
                          field.handleChange(total > 0 && val > total ? total.toString() : e.target.value);
                        }} />
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
                        <Input placeholder="e.g. HBL, Meezan, etc." value={field.state.value || ""} onChange={(e) => field.handleChange(e.target.value)} />
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>
                  <form.Field name="transactionId">
                    {(field) => (
                      <Field>
                        <FieldLabel>{paymentMethod === "cheque" ? "Cheque Number" : "Transaction ID"}</FieldLabel>
                        <Input placeholder={paymentMethod === "cheque" ? "Enter cheque number" : "Enter transaction ID"} value={field.state.value || ""} onChange={(e) => field.handleChange(e.target.value)} />
                        <FieldError errors={field.state.meta.errors} />
                      </Field>
                    )}
                  </form.Field>
                </div>
              );
            }}
          />
        </>}
        </FieldGroup>

        <div className="flex justify-end pt-2">
          <Button type="submit" disabled={isPending} className="w-full sm:w-auto">
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isEditMode ? "Save Changes" : "Save Material"}
          </Button>
        </div>
      </form>
    </div>
  );
};
