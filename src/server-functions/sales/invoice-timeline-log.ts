import { createId } from "@paralleldrive/cuid2";
import type { db as rootDb } from "@/db";
import { invoiceTimelineEvents } from "@/db/schemas/sales-erp-schema";

export type InvoiceTimelineEventType =
  | "created"
  | "updated"
  | "dispatched"
  | "payment"
  | "status_change"
  | "recovery_attempt"
  | "escalation"
  | "return"
  | "closed"
  | "note";

export interface RecordTimelineEventInput {
  invoiceId: string;
  eventType: InvoiceTimelineEventType;
  title: string;
  description?: string;
  metadata?: Record<string, unknown>;
  actorId?: string;
  actorName?: string;
  eventDate?: Date;
}

type TxLike = Parameters<Parameters<typeof rootDb.transaction>[0]>[0] | typeof rootDb;

export async function recordInvoiceTimelineEvent(
  input: RecordTimelineEventInput,
  txOrDb: TxLike,
) {
  const [event] = await txOrDb
    .insert(invoiceTimelineEvents)
    .values({
      id: createId(),
      invoiceId: input.invoiceId,
      eventType: input.eventType,
      title: input.title,
      description: input.description ?? null,
      metadata: input.metadata ?? null,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      eventDate: input.eventDate ?? new Date(),
    })
    .returning();
  return event;
}
