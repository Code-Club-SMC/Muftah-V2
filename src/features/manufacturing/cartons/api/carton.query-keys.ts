export const cartonKeys = {
  all: () => ["cartons"] as const,
  byBatch: (batchId: string) => ["cartons", "batch", batchId] as const,
  detail: (id: string) => ["cartons", "detail", id] as const,
  auditLog: (id: string) => ["cartons", "audit", id] as const,
  batchKpis: (batchId: string) => ["production-runs", batchId, "kpis"] as const,
  batchAuditLog: (batchId: string) => ["production-runs", batchId, "audit"] as const,
  stockSessions: () => ["stock-count", "sessions"] as const,
  stockSessionDetail: (id: string) => ["stock-count", "detail", id] as const,
  integrityAlerts: () => ["integrity", "alerts"] as const,
} as const;