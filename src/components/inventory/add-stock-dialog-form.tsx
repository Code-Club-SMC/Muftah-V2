import { Button } from "../ui/button";
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
import { Loader2, Info, Factory, Calculator } from "lucide-react";
import { useForm } from "@tanstack/react-form";
import { useSuspenseQuery } from "@tanstack/react-query";
import { useState, useMemo, useEffect } from "react";
import { useAddStock } from "@/hooks/stock/use-add-stock";
import { getMaterialsFn } from "@/server-functions/inventory/get-materials-fn";
import { getInventoryFn } from "@/server-functions/inventory/get-inventory-fn";
import { getSuppliersFn } from "@/server-functions/suppliers/get-suppliers-fn";
import { addStockSchema } from "@/lib/validators/validators";
import { Textarea } from "../ui/textarea";
import { PurchaseRecord } from "@/components/suppliers/purchase-history-table";
import { PaymentMethodSelect } from "@/components/suppliers/payment-method-select";

const CostCalculatorEffect = ({
  form,
  quantity,
  pricePerUnit,
  pricePerKg,
  materialType,
  activeMaterial,
}: any) => {
  useEffect(() => {
    const qty = parseFloat(quantity || "0");
    let total = 0;

    if (qty > 0) {
      if (materialType === "chemical") {
        const price = parseFloat(pricePerUnit || "0");
        total = price * qty;
      } else if (materialType === "packaging" && activeMaterial) {
        const pkg = activeMaterial as any;
        if (pkg.type === "primary") {
          const weight = parseFloat(pkg.weightPerPack || "0");
          const price = parseFloat(pricePerKg || "0");
          if (weight > 0 && price > 0) {
            // Formula: (Weight/1000) * PricePerKg * Qty
            total = price * (weight / 1000) * qty;
          }
        } else {
          // Master / Sticker / Others -> Simple Unit Price
          const price = parseFloat(pricePerUnit || "0");
          total = price * qty;
        }
      }
    }

    const newCost = total > 0 ? Math.round(total).toString() : "";
    if (form.state.values.cost !== newCost) {
      // Always sync cost — even "0" so the field never shows a stale value
      form.setFieldValue("cost", newCost);
    }
  }, [quantity, pricePerUnit, pricePerKg, materialType, activeMaterial, form]);

  return null;
};

type Props = {
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  preselectedWarehouse: string | undefined;
  warehouses: Awaited<ReturnType<typeof getInventoryFn>>;
  itemToRestock?: PurchaseRecord | null;
  preselectedSupplierId?: string;
};

export const AddStockForm = ({
  onOpenChange,
  onSuccess,
  preselectedWarehouse,
  warehouses,
  itemToRestock,
  preselectedSupplierId,
}: Props) => {
  const [materialType, setMaterialType] = useState<"chemical" | "packaging">(
    (itemToRestock?.materialType as "chemical" | "packaging") || "chemical",
  );
  const { data: materials } = useSuspenseQuery({
    queryKey: ["materials"],
    queryFn: getMaterialsFn,
  });

  const { data: suppliers } = useSuspenseQuery({
    queryKey: ["suppliers"],
    queryFn: getSuppliersFn,
  });

  const mutate = useAddStock();

  const form = useForm({
    defaultValues: {
      warehouseId: preselectedWarehouse || "",
      materialType: (itemToRestock?.materialType || "chemical") as
        | "chemical"
        | "packaging",
      materialId:
        itemToRestock?.chemical?.id ||
        itemToRestock?.packagingMaterial?.id ||
        "",
      quantity: itemToRestock?.quantity || "",
      supplierId: preselectedSupplierId || "", // prioritizing explicit prop, though itemToRestock context usually implies it too
      cost: itemToRestock?.cost || "",
      notes: "",
      paymentMethod: itemToRestock?.paymentMethod || "pay_later",
      paymentStatus: "unpaid" as "paid" | "partial" | "unpaid",
      walletId: "",
      amountPaid: "",
      transactionId: "",
      bankName: "",
    },
    validators: {
      onSubmit: addStockSchema,
    },
    onSubmit: async ({ value }) => {
      await mutate.mutateAsync(
        { data: value },
        {
          onSuccess: () => {
            onSuccess();
            form.reset();
          },
        },
      );
    },
  });

  const availableMaterials =
    materialType === "chemical"
      ? materials?.chemicals || []
      : materials?.packagings || [];

  // Filter warehouses: If adding materials, MUST be factory_floor
  const availableWarehouses = useMemo(() => {
    return warehouses.filter((w) => w.type === "factory_floor");
  }, [warehouses]);

  // Check if preselected warehouse is valid
  const isPreselectedInvalid =
    preselectedWarehouse &&
    !availableWarehouses.find((w) => w.id === preselectedWarehouse);

  // Calculator State
  const [pricePerUnit, setPricePerUnit] = useState(""); // For chemicals/units
  const [pricePerKg, setPricePerKg] = useState(""); // For packaging (primary)

  const activeMaterial = useMemo(() => {
    if (!form.state.values.materialId || !materials) return null;
    if (materialType === "chemical")
      return materials.chemicals.find(
        (c: any) => c.id === form.state.values.materialId,
      );
    return materials.packagings.find(
      (p: any) => p.id === form.state.values.materialId,
    );
  }, [form.state.values.materialId, materials, materialType]);

  // Initialize unit costs from previous purchase if available.
  // We guard with activeMaterial being truthy so the reverse calc waits until
  // the material data is resolved — prevents wrong pricePerKg from null weight.
  useEffect(() => {
    if (!itemToRestock || !activeMaterial) return;

    const totalCost = parseFloat(itemToRestock.cost);
    const qty = parseFloat(itemToRestock.quantity);
    if (qty <= 0 || totalCost <= 0) return;

    if (
      materialType === "packaging" &&
      (activeMaterial as any)?.type === "primary"
    ) {
      // Reverse formula: Cost = (Weight/1000) * PricePerKg * Qty
      // => PricePerKg = Cost / ((Weight/1000) * Qty)
      const weight = parseFloat((activeMaterial as any).weightPerPack || "0");
      if (weight > 0) {
        const derivedPricePerKg = totalCost / ((weight / 1000) * qty);
        setPricePerKg(derivedPricePerKg.toFixed(2));
      } else {
        // Fallback: cost / qty as unit price
        setPricePerUnit((totalCost / qty).toFixed(2));
      }
    } else {
      setPricePerUnit((totalCost / qty).toFixed(2));
    }
    // Run once when activeMaterial becomes available (not on every qty change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMaterial?.id, itemToRestock?.id]);

  // Live Cost Calculation Effect is handled by CostCalculatorEffect component inserted below

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.Subscribe
        selector={(state) => state.values.quantity}
        children={(quantity) => (
          <CostCalculatorEffect
            form={form}
            quantity={quantity}
            pricePerUnit={pricePerUnit}
            pricePerKg={pricePerKg}
            materialType={materialType}
            activeMaterial={activeMaterial}
          />
        )}
      />

      {isPreselectedInvalid && (
        <div className="p-3 rounded-lg bg-red-50 text-red-600 text-xs flex items-center gap-2">
          <Info className="size-4" />
          Selected facility is not a Factory Floor. Please select a Factory
          Floor to add raw materials.
        </div>
      )}

      <FieldGroup>
        {/* Warehouse Selection */}
        <form.Field name="warehouseId">
          {(field) => (
            <Field>
              <FieldLabel>Facility (Factory Floor)</FieldLabel>
              <Select
                value={field.state.value}
                onValueChange={(value) => field.handleChange(value)}
                disabled={!!preselectedWarehouse && !isPreselectedInvalid}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select facility" />
                </SelectTrigger>
                <SelectContent>
                  {availableWarehouses.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      <div className="flex items-center gap-2">
                        <Factory className="size-3.5 opacity-50" />
                        {w.name}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <div className="flex items-center gap-4">
          {/* Material Type */}
          {itemToRestock ? (
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Material Type
              </label>
              <Input
                value={materialType === "chemical" ? "Chemical" : "Packaging"}
                disabled
                className="bg-muted opacity-100"
              />
            </div>
          ) : (
            <form.Field name="materialType">
              {(field) => (
                <Field className="flex-1">
                  <FieldLabel>Material Type</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(value: "chemical" | "packaging") => {
                      field.handleChange(value);
                      setMaterialType(value);
                      form.setFieldValue("materialId", "");
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="chemical">Chemical</SelectItem>
                      <SelectItem value="packaging">Packaging</SelectItem>
                    </SelectContent>
                  </Select>
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          )}

          {/* Material Selection */}
          {itemToRestock ? (
            <div className="flex-2 w-full space-y-2">
              <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Material
              </label>
              <Input
                value={
                  itemToRestock.chemical?.name ||
                  itemToRestock.packagingMaterial?.name ||
                  ""
                }
                disabled
                className="bg-muted opacity-100"
              />
            </div>
          ) : (
            <form.Field name="materialId">
              {(field) => (
                <Field className="flex-2">
                  <FieldLabel>Material</FieldLabel>
                  <Select
                    value={field.state.value}
                    onValueChange={(value) => field.handleChange(value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select material" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableMaterials.map((m: any) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                          {materialType === "packaging" && m.capacity && (
                            <span className="text-muted-foreground ml-1 text-[10px]">
                              ({m.capacity}
                              {m.capacityUnit})
                            </span>
                          )}
                          {materialType === "chemical" && m.unit && (
                            <span className="text-muted-foreground ml-1 text-[10px]">
                              ({m.unit})
                            </span>
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          )}
        </div>

        {/* Dynamic Cost Calculator */}
        {activeMaterial && (
          <div className="bg-primary/5 border border-primary/10 rounded-lg p-3 space-y-3">
            <div className="flex items-center gap-2 text-primary font-medium text-sm">
              <Calculator className="size-4" />
              <span>Cost Calculator</span>
            </div>

            {(materialType === "chemical" ||
              (activeMaterial as any).type !== "primary") && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground font-medium">
                    Quantity (
                    {materialType === "chemical"
                      ? (activeMaterial as any).unit
                      : "Units"}
                    )
                  </label>
                  <form.Field name="quantity">
                    {(field) => (
                      <Input
                        type="number"
                        placeholder="0.00"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        className="h-9 bg-background"
                      />
                    )}
                  </form.Field>
                </div>
                <div className="space-y-2">
                  <label className="text-xs text-muted-foreground font-medium">
                    Price /{" "}
                    {materialType === "chemical"
                      ? (activeMaterial as any).unit
                      : "Unit"}{" "}
                    (PKR)
                  </label>
                  <Input
                    type="number"
                    placeholder="0.00"
                    value={pricePerUnit}
                    onChange={(e) => setPricePerUnit(e.target.value)}
                    className="h-9 bg-background"
                  />
                </div>
              </div>
            )}

            {materialType === "packaging" &&
              (activeMaterial as any).type === "primary" && (
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground font-medium">
                      Qty (Bags)
                    </label>
                    <form.Field name="quantity">
                      {(field) => (
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                          className="h-9 bg-background"
                        />
                      )}
                    </form.Field>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground font-medium">
                      Weight/Pack (g)
                    </label>
                    <Input
                      value={(activeMaterial as any).weightPerPack || 0}
                      disabled
                      className="h-9 bg-background/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground font-medium">
                      Price/Kg (PKR)
                    </label>
                    <Input
                      type="number"
                      placeholder="e.g. 980"
                      value={pricePerKg}
                      onChange={(e) => setPricePerKg(e.target.value)}
                      className="h-9 bg-background"
                    />
                  </div>
                </div>
              )}

            <div className="text-[10px] text-muted-foreground italic flex justify-end">
              {materialType === "packaging" &&
              (activeMaterial as any).type === "primary" ? (
                <span>Formula: (Weight/1000) * Price/Kg * Qty</span>
              ) : (
                <span>Formula: Price/Unit * Qty</span>
              )}
            </div>
          </div>
        )}

        {/* Fallback Quantity for no active material */}
        {!activeMaterial && (
          <div className="grid grid-cols-2 gap-4">
            <form.Field name="quantity">
              {(field) => (
                <Field className="col-span-2">
                  <FieldLabel>Quantity</FieldLabel>
                  <Input
                    type="number"
                    step="0.001"
                    placeholder="0.00"
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {/* Supplier Selection */}
          <form.Field name="supplierId">
            {(field) => (
              <Field className="col-span-2">
                <FieldLabel>Supplier</FieldLabel>
                <Select
                  value={field.state.value}
                  onValueChange={(value) => field.handleChange(value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select supplier" />
                  </SelectTrigger>
                  <SelectContent>
                    {suppliers?.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.supplierName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
        </div>

        {/* Cost */}
        <form.Field name="cost">
          {(field) => (
            <Field>
              <FieldLabel>Total Cost</FieldLabel>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  PKR
                </span>
                <Input
                  className="pl-10"
                  type="number"
                  step="0.01"
                  placeholder="0.00"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
              </div>
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        <div className="grid grid-cols-2 gap-4">
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
                      <SelectTrigger>
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
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
              state.values.cost,
              state.values.amountPaid,
              state.values.paymentMethod,
            ]}
            children={([status, cost, paid, method]) => {
              if (method === "pay_later") return null;
              if (status !== "partial") return null;

              const total = parseFloat(cost || "0") || 0;
              const paidAmount = parseFloat(paid || "0") || 0;
              const remaining = total - paidAmount;

              return (
                <div className="col-span-2 space-y-2">
                  <form.Field name="amountPaid">
                    {(field) => (
                      <Field>
                        <FieldLabel>
                          Amount Paid <span className="text-red-500">*</span>
                        </FieldLabel>
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
                        <FieldDescription>
                          Total Cost: PKR {total.toLocaleString()}
                        </FieldDescription>
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
                <div className="col-span-2 space-y-4">
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
                        <FieldLabel>
                          {paymentMethod === "cheque" ? "Cheque Number" : "Transaction ID"}
                        </FieldLabel>
                        <Input
                          placeholder={paymentMethod === "cheque" ? "Enter cheque number" : "Enter transaction ID"}
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
        </div>

        {/* Notes */}
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

        <div className="flex gap-2 pt-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={form.state.isSubmitting}
            className="flex-1"
          >
            {form.state.isSubmitting ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : null}
            {itemToRestock ? "Restock" : "Add Stock"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
};
