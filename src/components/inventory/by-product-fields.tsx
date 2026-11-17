import { useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { containerCount } from "@/lib/inventory/by-products";

export type ByProductValue = { byProductTracked: boolean; containerName: string; containerSize: string };

const CONTAINER_SUGGESTIONS = ["Drum", "Bag", "Can", "Jar"];

/** "By-product" tick on a purchase. When ticked, the containers become sellable empties once used. */
export function ByProductFields({
  value,
  onChange,
  quantity,
  unit,
  disabled,
}: {
  value: ByProductValue;
  onChange: (next: ByProductValue) => void;
  quantity: string;
  unit: string;
  disabled?: boolean;
}) {
  const id = useId();
  const count = value.containerSize ? containerCount(quantity || "0", value.containerSize) : null;
  const name = value.containerName.trim() || "container";

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-tracked`}
          checked={value.byProductTracked}
          disabled={disabled}
          onCheckedChange={(checked) => onChange({ ...value, byProductTracked: checked === true })}
        />
        <label htmlFor={`${id}-tracked`} className="text-sm font-medium">
          By-product
        </label>
      </div>
      <p className="text-xs text-muted-foreground">Tick when the empty containers are sold once used.</p>
      {value.byProductTracked && (
        <div className="grid grid-cols-2 gap-3">
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>Container</FieldLabel>
            <Input
              id={`${id}-name`}
              list={`${id}-names`}
              maxLength={40}
              placeholder="e.g. Drum"
              value={value.containerName}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, containerName: e.target.value })}
            />
            <datalist id={`${id}-names`}>
              {CONTAINER_SUGGESTIONS.map((option) => (
                <option key={option} value={option} />
              ))}
            </datalist>
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-size`}>{`Container size (${unit})`}</FieldLabel>
            <Input
              id={`${id}-size`}
              type="number"
              inputMode="decimal"
              min="0"
              step="0.001"
              value={value.containerSize}
              disabled={disabled}
              onChange={(e) => onChange({ ...value, containerSize: e.target.value })}
            />
          </Field>
          <FieldDescription className="col-span-2">
            {Number(quantity) > 0 && value.containerSize ? (
              count === null ? (
                <span className="text-destructive">Quantity must be a whole number of containers</span>
              ) : (
                `${count} ${name}${count === 1 ? "" : "s"}`
              )
            ) : null}
          </FieldDescription>
        </div>
      )}
    </div>
  );
}
