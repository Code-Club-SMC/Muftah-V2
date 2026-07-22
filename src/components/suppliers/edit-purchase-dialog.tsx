import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Edit } from "lucide-react";
import { updatePurchaseRecordFn } from "@/server-functions/suppliers/update-purchase-record-fn";
import { useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchase: {
    id: string;
    quantity: string;
    cost: string;
    unitCost?: string | null;
    paidAmount?: string | null;
    notes?: string | null;
    transactionId?: string | null;
    invoiceNumber?: string | null;
    paymentMethod?: string | null;
    paymentStatus?: string | null;
    paidBy?: string | null;
    materialType: string;
    chemical?: {
      id: string;
      name: string;
      unit: string;
      minimumStockLevel: string | null;
    } | null;
    packagingMaterial?: {
      id: string;
      name: string;
      type: string;
      capacity: string | null;
      capacityUnit: string | null;
      minimumStockLevel: number | null;
    } | null;
  } | null;
};

export const EditPurchaseDialog = ({ open, onOpenChange, purchase }: Props) => {
  const queryClient = useQueryClient();

  const mutate = useMutation({
    mutationFn: updatePurchaseRecordFn,
    onSuccess: () => {
      toast.success("Purchase record updated successfully");
      queryClient.invalidateQueries({ queryKey: ["supplier"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["wallets"] });
      queryClient.invalidateQueries({ queryKey: ["expenses"] });
      onOpenChange(false);
    },
    onError: (err) =>
      toast.error(err.message || "Failed to update purchase record"),
  });

  const form = useForm({
    defaultValues: {
      quantity: purchase?.quantity || "",
      unitCost: purchase?.unitCost || "",
      cost: purchase?.cost || "",
      materialName: "",
      capacity: "",
      capacityUnit: "",
      minStock: "",
      invoiceNumber: purchase?.invoiceNumber || "",
      transactionId: purchase?.transactionId || "",
      notes: purchase?.notes || "",
    },
    onSubmit: async ({ value }) => {
      if (!purchase) return;
      await mutate.mutateAsync({
        data: {
          id: purchase.id,
          quantity: value.quantity,
          cost: value.cost,
          notes: value.notes,
          transactionId: value.transactionId,
          invoiceNumber: value.invoiceNumber,
          materialName: value.materialName,
          capacity: value.capacity,
          capacityUnit: value.capacityUnit,
          minStock: value.minStock,
        },
      });
    },
  });

  useEffect(() => {
    if (purchase) {
      form.setFieldValue("quantity", purchase.quantity);
      form.setFieldValue("unitCost", purchase.unitCost || "");
      form.setFieldValue("cost", purchase.cost);
      form.setFieldValue("notes", purchase.notes || "");
      form.setFieldValue("transactionId", purchase.transactionId || "");
      form.setFieldValue("invoiceNumber", purchase.invoiceNumber || "");

      if (purchase.materialType === "packaging" && purchase.packagingMaterial) {
        form.setFieldValue("materialName", purchase.packagingMaterial.name);
        form.setFieldValue("capacity", purchase.packagingMaterial.capacity || "");
        form.setFieldValue("capacityUnit", purchase.packagingMaterial.capacityUnit || "");
        form.setFieldValue("minStock", purchase.packagingMaterial.minimumStockLevel?.toString() || "0");
      } else if (purchase.materialType === "chemical" && purchase.chemical) {
        form.setFieldValue("materialName", purchase.chemical.name);
        form.setFieldValue("minStock", purchase.chemical.minimumStockLevel || "0");
      }
    }
  }, [purchase, form]);

  if (!purchase) return null;

  const itemName = purchase.chemical?.name || purchase.packagingMaterial?.name || "Unknown Item";
  const isChemical = purchase.materialType === "chemical";
  const isPackaging = purchase.materialType === "packaging";
  const pkgType = purchase.packagingMaterial?.type;
  const originalPaid = parseFloat(purchase.paidAmount || "0");

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Edit Purchase Record"
      description={`Editing purchase for ${itemName}`}
      icon={Edit}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          form.handleSubmit();
        }}
        className="space-y-4"
      >
        {/* ─── QUANTITY + UNIT COST → live total ─── */}
        <div className="grid grid-cols-2 gap-4">
          <form.Field name="quantity">
            {(field) => (
              <Field>
                <FieldLabel>
                  Quantity ({isChemical ? purchase.chemical?.unit || "units" : "Bags/Units"})
                </FieldLabel>
                <Input
                  type="number"
                  step="any"
                  value={field.state.value || ""}
                  onChange={(e) => {
                    field.handleChange(e.target.value);
                    const unitCost = parseFloat(form.state.values.unitCost || "0");
                    const qty = parseFloat(e.target.value || "0");
                    if (unitCost > 0 && qty > 0) {
                      form.setFieldValue("cost", (unitCost * qty).toFixed(2));
                    }
                  }}
                  placeholder="e.g. 500"
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="unitCost">
            {(field) => (
              <Field>
                <FieldLabel>Unit Cost (PKR)</FieldLabel>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">PKR</span>
                  <Input
                    className="pl-10"
                    type="number"
                    step="0.01"
                    value={field.state.value || ""}
                    onChange={(e) => {
                      field.handleChange(e.target.value);
                      const qty = parseFloat(form.state.values.quantity || "0");
                      const unitCost = parseFloat(e.target.value || "0");
                      if (unitCost > 0 && qty > 0) {
                        form.setFieldValue("cost", (unitCost * qty).toFixed(2));
                      }
                    }}
                    placeholder="0.00"
                  />
                </div>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
        </div>

        {/* ─── LIVE COST SUMMARY ─── */}
        <form.Subscribe
          selector={(state) => [state.values.quantity, state.values.unitCost, state.values.cost]}
          children={([qty, unitCost, cost]) => {
            const total = parseFloat(cost || "0");
            const pending = total - originalPaid;
            if (total <= 0) return null;
            return (
              <div className="rounded-lg border bg-muted/30 p-3 grid grid-cols-3 gap-3 text-center text-sm">
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
              </div>
            );
          }}
        />

        {/* hidden cost field — kept in sync by quantity/unitCost onChange */}
        <form.Field name="cost">
          {(field) => (
            <Field>
              <FieldLabel>Total Cost (PKR)</FieldLabel>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">PKR</span>
                <Input
                  className="pl-10"
                  type="number"
                  step="0.01"
                  value={field.state.value || ""}
                  onChange={(e) => field.handleChange(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <form.Field name="invoiceNumber">
          {(field) => (
            <Field>
              <FieldLabel>Invoice / Reference Number</FieldLabel>
              <Input
                value={field.state.value || ""}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="e.g. INV-123"
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        {/* ─── CHEMICAL METADATA ─── */}
        {isChemical && (
          <>
            <form.Field name="materialName">
              {(field) => (
                <Field>
                  <FieldLabel>Chemical Name</FieldLabel>
                  <Input
                    value={field.state.value || ""}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Chemical name"
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            <form.Field name="minStock">
              {(field) => (
                <Field>
                  <FieldLabel>Min Stock Alert ({purchase.chemical?.unit})</FieldLabel>
                  <Input
                    type="number"
                    value={field.state.value || ""}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="e.g. 50"
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          </>
        )}

        {/* ─── PACKAGING METADATA ─── */}
        {isPackaging && (
          <>
            <form.Field name="materialName">
              {(field) => (
                <Field>
                  <FieldLabel>Material Name</FieldLabel>
                  <Input
                    value={field.state.value || ""}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="Enter material name"
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
            <div className="grid grid-cols-2 gap-4">
              <form.Field name="capacity">
                {(field) => (
                  <Field>
                    <FieldLabel>{pkgType === "master" ? "Units Per Carton" : "Fill Capacity"}</FieldLabel>
                    <Input
                      type="number"
                      value={field.state.value || ""}
                      onChange={(e) => field.handleChange(e.target.value)}
                      placeholder="e.g. 24 or 500"
                    />
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
              <form.Field name="capacityUnit">
                {(field) => (
                  <Field>
                    <FieldLabel>{pkgType === "master" ? "Inner Item Content" : "Unit"}</FieldLabel>
                    {pkgType === "master" ? (
                      <Input
                        value={field.state.value || ""}
                        onChange={(e) => field.handleChange(e.target.value)}
                        placeholder="e.g. 500ml Bottles"
                      />
                    ) : (
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
                    )}
                    <FieldError errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>
            </div>
            <form.Field name="minStock">
              {(field) => (
                <Field>
                  <FieldLabel>{pkgType === "master" ? "Min Stock Alert" : "Min Stock"}</FieldLabel>
                  <Input
                    type="number"
                    value={field.state.value || ""}
                    onChange={(e) => field.handleChange(e.target.value)}
                    placeholder="e.g. 100"
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          </>
        )}

        {/* ─── NOTES ─── */}
        <form.Field name="notes">
          {(field) => (
            <Field>
              <FieldLabel>Notes</FieldLabel>
              <Textarea
                value={field.state.value || ""}
                onChange={(e) => field.handleChange(e.target.value)}
                placeholder="Add notes here..."
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <div className="flex justify-end gap-2 pt-4">
          <Button variant="outline" type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" disabled={mutate.isPending}>
            {mutate.isPending && <Loader2 className="mr-2 size-4 animate-spin" />}
            Save Changes
          </Button>
        </div>
      </form>
    </ResponsiveDialog>
  );
};
