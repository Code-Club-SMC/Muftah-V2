import { useState } from "react";
import Big from "big.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getFillPerContainer } from "@/lib/production/packaging-quantity";
import { calculatePackingLine } from "@/lib/production/batch-packing";
import { packingLineInput, type PackingDraftLine } from "./packing-draft";

export type PackingFormat = {
  id: string;
  name: string;
  fillAmount: string | null;
  fillUnit: string | null;
  containersPerCarton: number;
  usesCartons: boolean;
};

export function PackingFormatRow({
  line,
  format,
  bulkUnit,
  index,
  onChange,
  onRemove,
  disabled,
}: {
  line: PackingDraftLine;
  format: PackingFormat;
  bulkUnit: string;
  index: number;
  onChange: (line: PackingDraftLine) => void;
  onRemove: () => void;
  disabled: boolean;
}) {
  const [mode, setMode] = useState("counts");
  const [weight, setWeight] = useState("");
  const [weightNote, setWeightNote] = useState("");
  const [weightError, setWeightError] = useState("");
  const [distribution, setDistribution] = useState(
    format.usesCartons ? "cartons" : "loose",
  );
  const id = `packing-${format.id}`;
  let result: ReturnType<typeof calculatePackingLine> | undefined;
  let error = "";
  const touched = [
    line.fullCartons,
    line.partialPacks,
    line.loosePacks,
    line.actualBulk,
  ].some(Boolean);
  try {
    if (touched)
      result = calculatePackingLine(packingLineInput(line), format, bulkUnit);
  } catch (caught) {
    error =
      caught instanceof Error ? caught.message : "Check these quantities.";
  }

  function update(key: keyof PackingDraftLine, value: string) {
    setWeightNote("");
    onChange({ ...line, [key]: value });
  }

  function applyWeight() {
    try {
      if (!/^\d+(\.\d{1,3})?$/.test(weight) || new Big(weight).lte(0)) {
        throw new Error(
          `Enter a positive ${bulkUnit} amount, with up to 3 decimal places.`,
        );
      }
      const fill = getFillPerContainer(
        format.fillAmount,
        format.fillUnit,
        bulkUnit,
      );
      const packs = new Big(weight)
        .div(fill)
        .round(0, Big.roundDown)
        .toNumber();
      if (!Number.isSafeInteger(packs) || packs < 1)
        throw new Error("This amount is less than one full pack.");
      const inCartons = distribution === "cartons" && format.usesCartons;
      const full = inCartons
        ? Math.floor(packs / format.containersPerCarton)
        : 0;
      onChange({
        ...line,
        fullCartons: String(full),
        partialPacks: "",
        loosePacks: String(packs - full * format.containersPerCarton),
        actualBulk: "",
        varianceReason: "",
      });
      const remainder = new Big(weight).minus(fill.times(packs));
      setWeightNote(
        `${packs.toLocaleString()} whole packs. ${remainder.toString()} ${bulkUnit} remains from this amount. Check these counts against the floor.`,
      );
      setWeightError("");
    } catch (caught) {
      setWeightError(
        caught instanceof Error ? caught.message : "Check the amount.",
      );
    }
  }

  const countField = (
    key: "fullCartons" | "partialPacks" | "loosePacks",
    label: string,
    help: string,
  ) => (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
      <Input
        id={`${id}-${key}`}
        aria-label={`${format.name}: ${label}`}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        placeholder="0"
        value={line[key]}
        disabled={disabled}
        aria-invalid={!!error}
        aria-describedby={`${id}-${key}-help${error ? ` ${id}-error` : ""}`}
        className="h-12"
        onChange={(event) => update(key, event.target.value)}
      />
      <FieldDescription id={`${id}-${key}-help`}>{help}</FieldDescription>
    </Field>
  );

  return (
    <Card size="sm" role="region" aria-label={`Packing format ${format.name}`}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <Badge variant="outline">
              {String(index + 1).padStart(2, "0")}
            </Badge>
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle>{format.name}</CardTitle>
              <CardDescription>
                {format.fillAmount} {format.fillUnit} per pack ·{" "}
                {format.usesCartons
                  ? `${format.containersPerCarton} packs per carton`
                  : "Packed without cartons"}
              </CardDescription>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={onRemove}
            aria-label={`Remove ${format.name}`}
          >
            Remove
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <ToggleGroup
          type="single"
          variant="outline"
          value={mode}
          disabled={disabled}
          onValueChange={(value) => value && setMode(value)}
          aria-label={`Entry method for ${format.name}`}
        >
          <ToggleGroupItem value="counts">Enter counts</ToggleGroupItem>
          <ToggleGroupItem value="weight">
            Calculate from {bulkUnit}
          </ToggleGroupItem>
        </ToggleGroup>
        {mode === "weight" && (
          <FieldGroup className="rounded-xl border border-dashed p-4">
            <Field data-invalid={!!weightError}>
              <FieldLabel htmlFor={`${id}-weight`}>
                Amount to calculate ({bulkUnit})
              </FieldLabel>
              <Input
                id={`${id}-weight`}
                inputMode="decimal"
                value={weight}
                disabled={disabled}
                className="h-12"
                aria-invalid={!!weightError}
                aria-describedby={
                  weightError ? `${id}-weight-error` : undefined
                }
                onChange={(event) => setWeight(event.target.value)}
              />
              {weightError && (
                <FieldError id={`${id}-weight-error`}>{weightError}</FieldError>
              )}
            </Field>
            {format.usesCartons && (
              <ToggleGroup
                type="single"
                variant="outline"
                value={distribution}
                disabled={disabled}
                className="max-w-full flex-wrap gap-2"
                aria-label={`Packing arrangement for ${format.name}`}
                onValueChange={(value) => value && setDistribution(value)}
              >
                <ToggleGroupItem value="cartons">
                  Full cartons + loose
                </ToggleGroupItem>
                <ToggleGroupItem value="loose">All loose packs</ToggleGroupItem>
              </ToggleGroup>
            )}
            <Button
              type="button"
              variant="secondary"
              disabled={disabled}
              onClick={applyWeight}
            >
              Calculate pack counts
            </Button>
            {weightNote && (
              <p role="status" className="text-sm text-muted-foreground">
                {weightNote}
              </p>
            )}
          </FieldGroup>
        )}
        <FieldGroup className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {format.usesCartons &&
            countField(
              "fullCartons",
              "Full cartons",
              `${format.containersPerCarton} packs in each carton`,
            )}
          {countField(
            "loosePacks",
            "Loose packs",
            "Sealed packs outside cartons",
          )}
        </FieldGroup>
        <details open={line.partialPacks || line.actualBulk ? true : undefined}>
          <summary className="cursor-pointer py-2 text-sm font-medium focus-visible:outline-2">
            More options
          </summary>
          {format.usesCartons && (
            <details open={line.partialPacks ? true : undefined}>
              <summary className="cursor-pointer py-2 text-sm font-medium focus-visible:outline-2">
                Add a partial carton
              </summary>
              <FieldGroup className="pt-3">
                {countField(
                  "partialPacks",
                  "Packs in partial carton",
                  `One physical carton, fewer than ${format.containersPerCarton} packs`,
                )}
              </FieldGroup>
            </details>
          )}
          <details open={line.actualBulk ? true : undefined}>
            <summary className="cursor-pointer py-2 text-sm font-medium focus-visible:outline-2">
              Record a measured weight difference
            </summary>
            <FieldGroup className="pt-3">
              <Field data-invalid={!!error}>
                <FieldLabel htmlFor={`${id}-actual`}>
                  Actual powder or liquid used ({bulkUnit})
                </FieldLabel>
                <Input
                  id={`${id}-actual`}
                  inputMode="decimal"
                  value={line.actualBulk}
                  disabled={disabled}
                  className="h-12"
                  aria-invalid={!!error}
                  aria-describedby={`${id}-actual-help${error ? ` ${id}-error` : ""}`}
                  onChange={(event) => update("actualBulk", event.target.value)}
                />
                <FieldDescription id={`${id}-actual-help`}>
                  Only enter a measured amount if it differs from the saved pack
                  weight. Exclude spills.
                </FieldDescription>
              </Field>
              <Field data-invalid={!!error}>
                <FieldLabel htmlFor={`${id}-reason`}>
                  Reason for weight difference
                </FieldLabel>
                <Input
                  id={`${id}-reason`}
                  value={line.varianceReason}
                  disabled={disabled}
                  maxLength={500}
                  aria-invalid={!!error}
                  aria-describedby={error ? `${id}-error` : undefined}
                  onChange={(event) =>
                    update("varianceReason", event.target.value)
                  }
                />
              </Field>
            </FieldGroup>
          </details>
        </details>
        {error && <FieldError id={`${id}-error`}>{error}</FieldError>}
      </CardContent>
      <CardFooter className="flex flex-wrap justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {result
            ? `${result.totalPacks.toLocaleString()} packs · ${result.physicalCartons.toLocaleString()} physical cartons`
            : "Enter the counts already packed"}
        </span>
        <span className="font-semibold tabular-nums">
          {result
            ? `${new Big(result.actualBulk).toString()} ${bulkUnit}`
            : `0 ${bulkUnit}`}
        </span>
      </CardFooter>
    </Card>
  );
}
