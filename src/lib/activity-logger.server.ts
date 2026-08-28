import { getRequestHeaders } from "@tanstack/react-start/server";
import { db, systemActivityLog } from "@/db";

// ── SYSTEM ACTIVITY LOGGER ─────────────────────────────────────────────────
// Fire-and-forget utility for recording system-wide mutations.
// Never throws — failures are swallowed to avoid disrupting business logic.
// Called from server functions AFTER the main operation succeeds.

export type ActivitySeverity = "info" | "warning" | "critical";

export type ActivityModule =
  | "sales"
  | "finance"
  | "hr"
  | "manufacturing"
  | "inventory"
  | "suppliers"
  | "user-management"
  | "auth";

export interface LogActivityParams {
  module: ActivityModule;
  action: string;
  entityType: string;
  entityId?: string;
  entityLabel?: string;
  actorId: string;
  actorName: string;
  description: string;
  metadata?: Record<string, unknown>;
  severity?: ActivitySeverity;
}

/**
 * Extract the client IP from request headers (Railway / reverse proxy aware).
 * Returns null when called outside a request context.
 */
function getClientIp(): string | null {
  try {
    const headers = getRequestHeaders() as unknown as Record<
      string,
      string | undefined
    >;
    return headers["x-forwarded-for"]?.split(",")[0]?.trim()
      ?? headers["x-real-ip"]
      ?? null;
  } catch {
    return null;
  }
}

/**
 * Record a system-wide activity event. Fire-and-forget — never throws.
 *
 * Call this after a successful mutation in any server function:
 * ```ts
 * await logActivity({
 *   module: "sales",
 *   action: "created",
 *   entityType: "invoice",
 *   entityId: invoice.id,
 *   entityLabel: `INV-${invoice.invoiceNumber}`,
 *   actorId: ctx.session.user.id,
 *   actorName: ctx.session.user.name,
 *   description: `Created invoice INV-${invoice.invoiceNumber} for ${customer.name}`,
 * });
 * ```
 */
export async function logActivity(params: LogActivityParams): Promise<void> {
  try {
    await db.insert(systemActivityLog).values({
      module: params.module,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId ?? null,
      entityLabel: params.entityLabel ?? null,
      actorId: params.actorId,
      actorName: params.actorName,
      description: params.description,
      metadata: params.metadata ?? null,
      ipAddress: getClientIp(),
      severity: params.severity ?? "info",
    });
  } catch (error) {
    // Swallow — activity logging must never break the main operation.
    console.error("[ActivityLog] Failed to record event:", error);
  }
}

/**
 * Convenience: log and return void. For one-liner usage in `.then()` chains.
 */
export const logActivityQuiet = (params: LogActivityParams): void => {
  void logActivity(params);
};
