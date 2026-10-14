import { z } from "zod";

export const productionDateSchema = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith("0000"))
    return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}, "Enter a valid calendar date");

export const productionDateFields = {
  from: productionDateSchema.optional(),
  to: productionDateSchema.optional(),
};

export function validateProductionDateRange(
  data: { from?: string; to?: string },
  context: z.RefinementCtx,
) {
  if (data.from && data.to && data.from > data.to) {
    context.addIssue({
      code: "custom",
      path: ["to"],
      message: "End date must be on or after start date",
    });
  }
}

export const productionDateRangeSchema = z
  .object(productionDateFields)
  .superRefine(validateProductionDateRange);

/** Inclusive Pakistan calendar days, with the next midnight as the exclusive end. */
export function productionDateBounds(data: { from?: string; to?: string }) {
  return {
    from: data.from ? new Date(`${data.from}T00:00:00+05:00`) : undefined,
    to: data.to
      ? new Date(new Date(`${data.to}T00:00:00+05:00`).getTime() + 86_400_000)
      : undefined,
  };
}

export type ProductionListFilters<Status extends string = string> = {
  from?: string;
  to?: string;
  status?: Status;
};

const createdDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Karachi",
  year: "numeric",
  month: "short",
  day: "numeric",
});

export function formatProductionCreatedDate(value: Date | string) {
  return createdDateFormatter.format(new Date(value));
}
