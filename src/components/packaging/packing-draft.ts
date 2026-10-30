import { z } from "zod";
import { lotPickSchema, materialLotPicksSchema } from "@/lib/inventory/material-lots";
import { POWDER_LOSS_REASONS, reasonCodes } from "@/lib/production/material-use";

const lineSchema = z.object({
  recipeId: z.string(),
  fullCartons: z.string(),
  partialPacks: z.string(),
  loosePacks: z.string(),
  actualBulk: z.string(),
  varianceReason: z.string(),
});

export const packingSubmissionSchema = z.object({
  mixingRunId: z.string(),
  requestId: z.string(),
  packedAt: z.string(),
  lines: z.array(
    z.object({
      recipeId: z.string(),
      fullCartons: z.number().int().nonnegative(),
      partialPacks: z.number().int().nonnegative(),
      loosePacks: z.number().int().nonnegative(),
      actualBulk: z.string().optional(),
      varianceReason: z.string().optional(),
    }),
  ),
  lossBulk: z.string(),
  lossReason: z.enum(reasonCodes(POWDER_LOSS_REASONS)).optional(),
  lossNote: z.string().optional(),
  lotPicks: z.array(materialLotPicksSchema).default([]),
});

export const packingDraftSchema = z.object({
  version: z.literal(1),
  requestId: z.string(),
  packedAt: z.string(),
  lines: z.array(lineSchema),
  lossBulk: z.string(),
  lossReason: z.string(),
  // Drafts saved before lots existed have no picks.
  lotPicks: z.record(z.string(), z.array(lotPickSchema)).default({}),
  submitted: packingSubmissionSchema.optional(),
});

export type PackingDraft = z.infer<typeof packingDraftSchema>;
export type PackingDraftLine = z.infer<typeof lineSchema>;
export type PackingSubmission = z.infer<typeof packingSubmissionSchema>;

export function newPackingDraft(): PackingDraft {
  return {
    version: 1,
    requestId: crypto.randomUUID(),
    packedAt: new Date().toISOString(),
    lines: [],
    lossBulk: "",
    lossReason: "",
    lotPicks: {},
  };
}

export function emptyPackingLine(recipeId: string): PackingDraftLine {
  return {
    recipeId,
    fullCartons: "",
    partialPacks: "",
    loosePacks: "",
    actualBulk: "",
    varianceReason: "",
  };
}

export function readPackCount(value: string) {
  if (!/^\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error("Enter a whole number of cartons or packs, zero or more.");
  }
  return Number(value || 0);
}

export function packingLineInput(line: PackingDraftLine) {
  return {
    recipeId: line.recipeId,
    fullCartons: readPackCount(line.fullCartons),
    partialPacks: readPackCount(line.partialPacks),
    loosePacks: readPackCount(line.loosePacks),
    ...(line.actualBulk ? { actualBulk: line.actualBulk } : {}),
    ...(line.varianceReason ? { varianceReason: line.varianceReason } : {}),
  };
}
