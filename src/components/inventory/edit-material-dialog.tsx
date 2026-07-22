import { useForm } from "@tanstack/react-form";
import { Loader2, Package, Box } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useUpdateMaterial } from "@/hooks/inventory/use-material-actions";
import { Field, FieldError, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
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

  const form = useForm({
    defaultValues: {
      name: material?.name || "",
      unit: material?.unit || (type === "chemical" ? "kg" : ""),
      costPerUnit: material?.costPerUnit || "0",
      minimumStockLevel: material?.minimumStockLevel || "0",
      quantity: item.quantity || "0",
      materialType:
        (material?.type?.toLowerCase() as "primary" | "master") || "primary",
      capacity: material?.capacity || "",
      capacityUnit: material?.capacityUnit || "",
    },
    onSubmit: async ({ value }) => {
      await mutate.mutateAsync(
        {
          data: {
            id: material.id,
            stockId: item.id,
            type,
            data: {
              name: value.name,
              unit: value.unit,
              costPerUnit: value.costPerUnit,
              minimumStockLevel: value.minimumStockLevel,
              quantity: value.quantity,
              materialType: value.materialType,
              capacity: value.capacity,
              capacityUnit: value.capacityUnit,
            },
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

              <form.Field name="quantity">
                {(field) => (
                  <Field>
                    <FieldLabel>Stock Quantity</FieldLabel>
                    <Input
                      type="number"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                  </Field>
                )}
              </form.Field>

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
                    <FieldLabel>Cost Per Unit</FieldLabel>
                    <Input
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
