import { useState } from "react";
import { useForm } from "@tanstack/react-form";
import Big from "big.js";
import { Loader2, Package, Box } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useUpdateMaterial } from "@/hooks/inventory/use-material-actions";
import { useMaterialLots } from "@/hooks/stock/use-material-lots";
import { lotLabel } from "@/lib/inventory/material-lots";
import { packagingUnit } from "@/lib/inventory/material-units";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { useQueryClient } from "@tanstack/react-query";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: "chemical" | "packaging";
  item: any;
};

export const EditMaterialDialog = ({
  open,
  onOpenChange,
  type,
  item,
}: Props) => {
  const mutate = useUpdateMaterial();
  const queryclient = useQueryClient();
  const material = type === "chemical" ? item.chemical : item.packagingMaterial;
  const unit = type === "chemical" ? material?.unit || "kg" : packagingUnit(material);
  const [lotId, setLotId] = useState("");
  const { data: storeLots, isLoading: lotsLoading } = useMaterialLots(
    open ? item?.warehouseId : undefined,
    type,
    [material?.id],
  );
  const lots = storeLots?.[material?.id] ?? [];
  // A single lot is picked for the person; with more than one they choose.
  const chosenLotId = lotId || (lots.length === 1 ? lots[0].lotId : "");
  // The server makes the final call; this only stops an obviously locked change.
  const kgLocked = Number(item?.quantity) > 0 || lots.length > 0;
  const stockChange = (quantity: string) => {
    try {
      return new Big(quantity || "0").minus(item?.quantity || "0");
    } catch {
      return new Big(0);
    }
  };

  const form = useForm({
    defaultValues: {
      name: material?.name || "",
      unit: material?.unit || (type === "chemical" ? "kg" : ""),
      costPerUnit: material?.costPerUnit || "0",
      minimumStockLevel: material?.minimumStockLevel || "0",
      quantity: new Big(item?.quantity || "0").toString(),
      materialType:
        (material?.type?.toLowerCase() as "primary" | "master") || "primary",
      capacity: material?.capacity || "",
      capacityUnit: material?.capacityUnit || "",
      measuredInKg: !!material?.measuredInKg,
      weightPerPack: material?.weightPerPack || "",
    },
    onSubmit: async ({ value }) => {
      const changed = !stockChange(value.quantity).eq(0);
      await mutate.mutateAsync(
        {
          data: {
            id: material.id,
            type,
            data: {
              name: value.name,
              unit: value.unit,
              costPerUnit: value.costPerUnit,
              minimumStockLevel: value.minimumStockLevel,
              materialType: value.materialType,
              capacity: value.capacity,
              capacityUnit: value.capacityUnit,
              ...(type === "packaging"
                ? { measuredInKg: value.measuredInKg, weightPerPack: value.weightPerPack || undefined }
                : {}),
            },
            stock: changed
              ? { stockId: item.id, quantity: value.quantity, lotId: chosenLotId || undefined }
              : undefined,
          },
        },
        {
          onSuccess: () => {
            queryclient.invalidateQueries({
              queryKey: ["inventory", "stock", "list"],
            });
            onOpenChange(false);
          },
        },
      );
    },
  });

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Edit {type === "chemical" ? "Chemical" : "Packaging Material"}
          </DialogTitle>
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
            {type === "packaging" && (
              <form.Field name="materialType">
                {(field) => (
                  <div className="grid grid-cols-2 gap-2 p-1 bg-muted rounded-lg border">
                    <button
                      type="button"
                      disabled={material?.type?.toLowerCase() === "master"}
                      onClick={() => {
                        field.handleChange("primary");
                        if (!form.getFieldValue("capacityUnit")) {
                          form.setFieldValue("capacityUnit", "ml");
                        }
                      }}
                      className={cn(
                        "flex items-center justify-center gap-2 py-2 text-sm font-semibold rounded-md transition-all duration-200",
                        field.state.value === "primary"
                          ? "bg-background  text-primary ring-1 ring-black/5"
                          : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                        material?.type?.toLowerCase() === "master" &&
                          "opacity-50 cursor-not-allowed",
                      )}
                    >
                      <Package
                        className={cn(
                          "size-4",
                          field.state.value === "primary"
                            ? "text-primary"
                            : "text-muted-foreground",
                        )}
                      />
                      Primary
                    </button>
                    <button
                      type="button"
                      disabled={material?.type?.toLowerCase() === "primary"}
                      onClick={() => {
                        field.handleChange("master");
                        if (!form.getFieldValue("capacityUnit")) {
                          form.setFieldValue("capacityUnit", "units");
                        }
                      }}
                      className={cn(
                        "flex items-center justify-center gap-2 py-2 text-sm font-semibold rounded-md transition-all duration-200",
                        field.state.value === "master"
                          ? "bg-background  text-primary ring-1 ring-black/5"
                          : "text-muted-foreground hover:bg-background/50 hover:text-foreground",
                        material?.type?.toLowerCase() === "primary" &&
                          "opacity-50 cursor-not-allowed",
                      )}
                    >
                      <Box
                        className={cn(
                          "size-4",
                          field.state.value === "master"
                            ? "text-primary"
                            : "text-muted-foreground",
                        )}
                      />
                      Master
                    </button>
                  </div>
                )}
              </form.Field>
            )}

            <form.Field name="name">
              {(field) => (
                <Field>
                  <FieldLabel>Material Name</FieldLabel>
                  <Input
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  <FieldError errors={field.state.meta.errors} />
                </Field>
              )}
            </form.Field>

            {type === "packaging" && (
              <form.Subscribe selector={(state) => state.values.materialType}>
                {(materialType) =>
                  materialType === "primary" && (
                    <form.Field name="measuredInKg">
                      {(field) => (
                        <Field orientation="horizontal">
                          <Switch
                            id="edit-measured-in-kg"
                            checked={field.state.value}
                            disabled={kgLocked}
                            onCheckedChange={(checked) => field.handleChange(checked)}
                          />
                          <div>
                            <FieldLabel htmlFor="edit-measured-in-kg">Measured in KG</FieldLabel>
                            <FieldDescription>
                              {kgLocked
                                ? "Locked: this material already has stock or history."
                                : "Turn on for shoppers bought and used by weight."}
                            </FieldDescription>
                          </div>
                        </Field>
                      )}
                    </form.Field>
                  )
                }
              </form.Subscribe>
            )}

            <form.Subscribe selector={(state) => state.values.measuredInKg && state.values.materialType === "primary"}>
              {(inKg) =>
                type === "packaging" && inKg && (
                  <form.Field name="weightPerPack">
                    {(field) => (
                      <Field>
                        <FieldLabel htmlFor="edit-weight-per-pack">Weight of one shopper (grams)</FieldLabel>
                        <Input
                          id="edit-weight-per-pack"
                          type="number"
                          value={field.state.value}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      </Field>
                    )}
                  </form.Field>
                )
              }
            </form.Subscribe>

            <div className="grid grid-cols-2 gap-4">
              {type === "packaging" && (
                <>
                  <form.Field name="capacity">
                    {(field) => (
                      <Field>
                        <FieldLabel>
                          {form.state.values.materialType === "primary"
                            ? "Fill Capacity"
                            : "Units per Carton"}
                        </FieldLabel>
                        <Input
                          type="number"
                          value={field.state.value || ""}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                      </Field>
                    )}
                  </form.Field>

                  <form.Field name="capacityUnit">
                    {(field) => (
                      <Field>
                        <FieldLabel>
                          {form.state.values.materialType === "primary"
                            ? "Unit"
                            : "Inner Content"}
                        </FieldLabel>
                        {form.state.values.materialType === "primary" ? (
                          <Select
                            value={field.state.value || "ml"}
                            onValueChange={(val) => field.handleChange(val)}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
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
                          />
                        )}
                      </Field>
                    )}
                  </form.Field>
                </>
              )}

              {type === "chemical" && (
                <form.Field name="unit">
                  {(field) => (
                    <Field>
                      <FieldLabel>Unit</FieldLabel>
                      <Select
                        value={field.state.value}
                        onValueChange={(val) => field.handleChange(val)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="kg">Kilograms (kg)</SelectItem>
                          <SelectItem value="liters">Liters (l)</SelectItem>
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                </form.Field>
              )}

              <form.Field name="costPerUnit">
                {(field) => (
                  <Field>
                    <form.Subscribe selector={(state) => type === "packaging" && state.values.measuredInKg && state.values.materialType === "primary"}>
                      {(inKg) => (
                        <FieldLabel htmlFor="edit-cost-per-unit">{inKg ? "Price per KG (PKR)" : "Cost Per Unit"}</FieldLabel>
                      )}
                    </form.Subscribe>
                    <Input
                      id="edit-cost-per-unit"
                      type="number"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </Field>
                )}
              </form.Field>

              <form.Field name="minimumStockLevel">
                {(field) => (
                  <Field>
                    <FieldLabel>Min Level</FieldLabel>
                    <Input
                      type="number"
                      value={field.state.value.toString()}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </Field>
                )}
              </form.Field>
            </div>

            <form.Field name="quantity">
              {(field) => {
                const change = stockChange(field.state.value);
                return (
                  <Field>
                    <FieldLabel>
                      Stock Quantity{item.warehouse?.name ? ` (${item.warehouse.name})` : ""}
                    </FieldLabel>
                    <Input
                      type="number"
                      step="0.001"
                      min="0"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    {!change.eq(0) && (
                      <div className="space-y-2">
                        <FieldLabel>
                          {change.gt(0)
                            ? `Add ${change.toString()} ${unit} to lot`
                            : `Take ${change.abs().toString()} ${unit} from lot`}
                        </FieldLabel>
                        {lotsLoading ? (
                          <p className="text-xs text-muted-foreground">Loading lots...</p>
                        ) : lots.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            No lot to change. Use Add stock to buy at a price.
                          </p>
                        ) : (
                          <Select value={chosenLotId} onValueChange={setLotId}>
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Pick a lot" />
                            </SelectTrigger>
                            <SelectContent>
                              {lots.map((lot) => (
                                <SelectItem key={lot.lotId} value={lot.lotId}>
                                  {lotLabel(lot, unit)}, {Number(lot.quantity)} {unit} here
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </div>
                    )}
                  </Field>
                );
              }}
            </form.Field>

            <Button
              disabled={form.state.isSubmitting}
              type="submit"
              className="w-full"
            >
              {form.state.isSubmitting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                "Update Material"
              )}
            </Button>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
};
