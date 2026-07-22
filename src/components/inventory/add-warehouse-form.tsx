import { useForm } from "@tanstack/react-form";
import { InfoIcon, Loader2, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAddWarehouse } from "@/hooks/inventory/use-add-warehouse";
import { addWarehouseSchema } from "@/lib/validators";
import { Field, FieldError, FieldGroup, FieldLabel } from "../ui/field";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { toast } from "sonner";

type Props = {
  onSuccess: () => void;
  forcedType?: "storage" | "factory_floor";
};

export const AddWarehouseForm = ({ onSuccess, forcedType }: Props) => {
  const mutate = useAddWarehouse();

  const form = useForm({
    defaultValues: {
      name: "",
      type: (forcedType || "storage") as "storage" | "factory_floor",
      address: "",
      city: "",
      state: "",
      latitude: "",
      longitude: "",
    },
    validators: {
      onSubmit: addWarehouseSchema,
    },
    onSubmit: async ({ value }) => {
      await mutate.mutateAsync(
        { data: value },
        {
          onSuccess: (data) => {
            onSuccess();
            toast.success(`${data.type} added successfully`);
          },
        },
      );
    },
  });

  // Helper to get browser location
  const handleGetLocation = () => {
    navigator.geolocation.getCurrentPosition((pos) => {
      form.setFieldValue("latitude", pos.coords.latitude.toString());
      form.setFieldValue("longitude", pos.coords.longitude.toString());
    });
  };

  return (
    <form
      className="space-y-4 max-w-md"
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
    >
      <FieldGroup>
        {/* Name Field */}
        <form.Field name="name">
          {(field) => (
            <Field>
              <FieldLabel>Facility Name</FieldLabel>
              <Input
                placeholder="e.g. North Warehouse or Factory Floor A"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        {/* Type Field */}
        {!forcedType && (
          <form.Field name="type">
            {(field) => (
              <Field>
                <FieldLabel>Facility Type</FieldLabel>
                <Select
                  value={field.state.value}
                  onValueChange={(value: "storage" | "factory_floor") =>
                    field.handleChange(value)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="storage">Storage Warehouse</SelectItem>
                    <SelectItem value="factory_floor">Factory Floor</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-start gap-2 mt-2 p-3 rounded-lg bg-blue-50/50 border border-blue-100 dark:bg-blue-900/10 dark:border-blue-900/20">
                  <InfoIcon className="size-4 text-blue-600 mt-0.5" />
                  <p className="text-[11px] text-blue-700/80 dark:text-blue-400">
                    {field.state.value === "factory_floor"
                      ? "Factory floors are used to store raw materials (chemicals and packaging) for production."
                      : "Storage warehouses are used to store finished goods ready for sale or transfer."}
                  </p>
                </div>
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
        )}

        {/* Location/Address Field */}
        <form.Field name="address">
          {(field) => (
            <Field>
              <FieldLabel>Address</FieldLabel>
              <Input
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
              />
              <FieldError errors={field.state.meta.errors} />
            </Field>
          )}
        </form.Field>

        {/* City and State Row */}
        <div className="grid grid-cols-2 gap-4">
          <form.Field name="city">
            {(field) => (
              <Field>
                <FieldLabel>City</FieldLabel>
                <Input
                  placeholder="e.g. Karachi"
                  value={field.state.value}
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
                <FieldLabel>State / Province</FieldLabel>
                <Input
                  placeholder="e.g. Sindh"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
        </div>

        {/* Coordinates Row */}
        <div className="grid grid-cols-2 gap-4">
          <form.Field name="latitude">
            {(field) => (
              <Field>
                <FieldLabel>Latitude (Optional)</FieldLabel>
                <Input
                  placeholder="e.g. 40.7128"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>

          <form.Field name="longitude">
            {(field) => (
              <Field>
                <FieldLabel>Longitude (Optional)</FieldLabel>
                <Input
                  placeholder="e.g. -74.0060"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                <FieldError errors={field.state.meta.errors} />
              </Field>
            )}
          </form.Field>
        </div>

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleGetLocation}
          className="w-fit"
        >
          <MapPin className="mr-2 size-4" /> Use Current Location
        </Button>

        <Button
          disabled={form.state.isSubmitting}
          type="submit"
          className="w-full"
        >
          {form.state.isSubmitting ? (
            <Loader2 className="mr-2 size-4 animate-spin" />
          ) : (
            "Add Facility"
          )}
        </Button>
      </FieldGroup>
    </form>
  );
};
