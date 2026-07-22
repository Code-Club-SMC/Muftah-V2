import { z } from "zod";

export const topUpSchema = z.object({
  cartonId: z.string().min(1),
  delta: z.number().int().positive("Pack count must be a positive whole number."),
  reason: z.string().max(500).optional(),
});

export const removePacksSchema = z.object({
  cartonId: z.string().min(1),
  delta: z.number().int().positive("Pack count must be a positive whole number."),
  reason: z.enum(["QC_FAIL", "DAMAGED", "TRANSFER", "OTHER"], {
    message: "A removal reason is required.",
  }),
  notes: z.string().max(500).optional(),
});

export const setCountSchema = z.object({
  cartonId: z.string().min(1),
  newCount: z.number().int().min(0, "Pack count cannot be negative."),
  reason: z
    .string()
    .min(5, "Please provide a reason of at least 5 characters.")
    .max(500),
});

export const bulkAdjustSchema = z.object({
  cartonIds: z.array(z.string().min(1)).min(1).max(200),
  delta: z.number().int().refine((v) => v !== 0, "Delta cannot be zero."),
  strategy: z.enum(["SKIP", "CAP"]),
  reason: z.string().min(5).max(500),
});

export const mergeSchema = z.object({
  sourceCartonIds: z
    .array(z.string().min(1))
    .min(1, "Select at least one source carton."),
  destinationCartonId: z.string().min(1),
});

export const repackSchema = z.object({
  cartonId: z.string().min(1),
  newCapacity: z.number().int().positive(),
  justification: z
    .string()
    .min(10, "Justification must be at least 10 characters.")
    .max(500),
});

export const retireSchema = z.object({
  cartonId: z.string().min(1),
  reason: z.enum(["LOST", "DESTROYED", "CONDEMNED", "OTHER"]),
  notes: z.string().max(500).optional(),
});

export const closeBatchSchema = z.object({
  productionRunId: z.string().min(1),
  acknowledgeShortfall: z.boolean().optional().default(false),
});

export const reopenBatchSchema = z.object({
  productionRunId: z.string().min(1),
  force: z.boolean().optional().default(false),
  reopenReason: z.string().min(5).max(500),
});

export const addCartonsSchema = z.object({
  productionRunId: z.string().min(1),
  count: z.number().int().min(1).max(500),
  zone: z.string().max(100).optional(),
});

export const transferSchema = z.object({
  sourceCartonId: z.string().min(1),
  destinationCartonId: z.string().min(1),
  packCount: z.number().int().positive(),
});

export const dispatchSchema = z.object({
  lines: z
    .array(
      z.object({
        cartonId: z.string().min(1),
        packsToDispatch: z.number().int().positive(),
      }),
    )
    .min(1),
  orderId: z.string().optional(),
  dispatchedBy: z.string().min(1),
});

export const holdSchema = z.object({
  cartonId: z.string().min(1),
  reason: z.string().min(5).max(500),
  expiresAt: z.string().datetime().optional(),
});

export const releaseHoldSchema = z.object({
  cartonId: z.string().min(1),
  outcome: z.enum(["CLEARED", "CONDEMNED"]),
  notes: z.string().max(500).optional(),
});

export const returnSchema = z.object({
  dispatchOrderId: z.string().min(1),
  lines: z
    .array(
      z.object({
        cartonId: z.string().min(1),
        packsReturned: z.number().int().positive(),
        condition: z.enum(["GOOD", "DAMAGED"]),
        destinationCartonId: z.string().min(1).optional(),
      }),
    )
    .min(1),
  notes: z.string().max(500).optional(),
});

export const createStockCountSchema = z.object({
  batchId: z.string().optional(),
  sku: z.string().optional(),
  notes: z.string().max(500).optional(),
});

export const updateStockCountLineSchema = z.object({
  lineId: z.string().min(1),
  physicalCount: z.number().int().min(0),
});

export const submitStockCountSchema = z.object({
  sessionId: z.string().min(1),
});

export const approveStockCountSchema = z.object({
  sessionId: z.string().min(1),
  approvedLines: z
    .array(
      z.object({
        lineId: z.string().min(1),
        approved: z.boolean(),
      }),
    )
    .min(1),
});

export const integrityCheckSchema = z.object({
  batchId: z.string().optional(),
});

export const updateIntegrityAlertSchema = z.object({
  alertId: z.string().min(1),
  status: z.enum(["ACKNOWLEDGED", "RESOLVED"]),
  resolution: z.string().max(500).optional(),
});

export const getAuditLogSchema = z.object({
  cartonId: z.string().optional(),
  batchId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const bulkCartonOperationSchema = z.object({
  cartonIds: z.array(z.string().min(1)).min(1),
  operationType: z.enum(["RETIRE", "TOP_UP", "REMOVE", "OVERRIDE", "REPACK", "QC_HOLD", "RELEASE_HOLD"]),
  payload: z.object({
    delta: z.number().int().positive().optional(),
    reason: z.string().max(500).optional(),
    notes: z.string().max(500).optional(),
    newCount: z.number().int().min(0).optional(),
    newCapacity: z.number().int().positive().optional(),
    justification: z.string().max(500).optional(),
    orderId: z.string().optional(),
    expiresAt: z.string().datetime().optional(),
    outcome: z.enum(["CLEARED", "CONDEMNED"]).optional(),
  }).optional(),
});

export type BulkCartonOperationInput = z.infer<typeof bulkCartonOperationSchema>;
export type TopUpInput = z.infer<typeof topUpSchema>;
export type RemovePacksInput = z.infer<typeof removePacksSchema>;
export type SetCountInput = z.infer<typeof setCountSchema>;
export type BulkAdjustInput = z.infer<typeof bulkAdjustSchema>;
export type MergeInput = z.infer<typeof mergeSchema>;
export type RepackInput = z.infer<typeof repackSchema>;
export type RetireInput = z.infer<typeof retireSchema>;
export type CloseBatchInput = z.infer<typeof closeBatchSchema>;
export type ReopenBatchInput = z.infer<typeof reopenBatchSchema>;
export type AddCartonsInput = z.infer<typeof addCartonsSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type DispatchInput = z.infer<typeof dispatchSchema>;
export type HoldInput = z.infer<typeof holdSchema>;
export type ReleaseHoldInput = z.infer<typeof releaseHoldSchema>;
export type ReturnInput = z.infer<typeof returnSchema>;