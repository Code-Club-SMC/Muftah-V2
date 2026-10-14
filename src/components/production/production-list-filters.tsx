import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import {
  productionDateRangeSchema,
  type ProductionListFilters as Filters,
} from "@/lib/production/list-filters";

export function ProductionListFilters<Status extends string>({
  value,
  onChange,
  statuses,
}: {
  value: Filters<Status>;
  onChange: (value: Filters<Status>) => void;
  statuses: { value: Status; label: string }[];
}) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string>();
  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        const validation = productionDateRangeSchema.safeParse(draft);
        if (!validation.success) {
          setError(validation.error.issues[0].message);
          return;
        }
        setError(undefined);
        onChange(draft);
      }}
    >
      <FieldDescription>
        Filter by creation date in Pakistan time. Both dates are inclusive. KPIs
        cover all matching records.
      </FieldDescription>
      <FieldGroup className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor={`${id}-from`}>Created from</FieldLabel>
          <Input
            id={`${id}-from`}
            type="date"
            value={draft.from ?? ""}
            aria-invalid={!!error}
            onChange={(event) =>
              setDraft({ ...draft, from: event.target.value || undefined })
            }
          />
        </Field>
        <Field data-invalid={!!error}>
          <FieldLabel htmlFor={`${id}-to`}>Created to</FieldLabel>
          <Input
            id={`${id}-to`}
            type="date"
            value={draft.to ?? ""}
            aria-invalid={!!error}
            onChange={(event) =>
              setDraft({ ...draft, to: event.target.value || undefined })
            }
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-status`}>Status</FieldLabel>
          <NativeSelect
            id={`${id}-status`}
            value={draft.status ?? "all"}
            onChange={(event) =>
              setDraft({
                ...draft,
                status:
                  event.target.value === "all"
                    ? undefined
                    : (event.target.value as Status),
              })
            }
          >
            <NativeSelectOption value="all">All statuses</NativeSelectOption>
            {statuses.map((status) => (
              <NativeSelectOption key={status.value} value={status.value}>
                {status.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
        <div className="flex shrink-0 gap-2">
          <Button type="submit">Apply filters</Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDraft({});
              setError(undefined);
              onChange({});
            }}
          >
            Clear filters
          </Button>
        </div>
      </FieldGroup>
      {error && <FieldError role="alert">{error}</FieldError>}
    </form>
  );
}
