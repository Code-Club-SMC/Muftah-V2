export class CartonError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = "CartonError";
  }
}

export class CartonNotFoundError extends CartonError {
  constructor(id: string) {
    super(`Carton not found: ${id}`, "CARTON_NOT_FOUND", 404);
  }
}

export class CartonLockedError extends CartonError {
  constructor(msg: string) {
    super(msg, "CARTON_LOCKED", 409);
  }
}

export class CartonOnHoldError extends CartonError {
  constructor(msg: string) {
    super(msg, "CARTON_ON_HOLD", 409);
  }
}

export class CapacityExceededError extends CartonError {
  constructor(msg: string) {
    super(msg, "CAPACITY_EXCEEDED", 422);
  }
}

export class InsufficientPacksError extends CartonError {
  constructor(msg: string) {
    super(msg, "INSUFFICIENT_PACKS", 422);
  }
}

export class CrossSkuError extends CartonError {
  constructor(msg: string) {
    super(msg, "CROSS_SKU_FORBIDDEN", 422);
  }
}

export class PermissionError extends CartonError {
  constructor(msg: string) {
    super(msg, "INSUFFICIENT_PERMISSION", 403);
  }
}

export class CartonAlreadyDispatchedError extends CartonError {
  constructor(msg: string) {
    super(msg, "CARTON_DISPATCHED", 409);
  }
}

export class IntegrityViolationError extends CartonError {
  constructor(msg: string) {
    super(msg, "INTEGRITY_VIOLATION", 500);
  }
}

export class BatchClosedError extends CartonError {
  constructor(msg: string) {
    super(msg, "BATCH_CLOSED", 409);
  }
}

export class BatchNotClosedError extends CartonError {
  constructor(msg: string) {
    super(msg, "BATCH_NOT_CLOSED", 409);
  }
}

export class YieldShortfallError extends CartonError {
  constructor(
    public readonly yieldPct: number,
    public readonly threshold: number,
  ) {
    super(
      `Batch yield (${yieldPct.toFixed(1)}%) is below minimum threshold (${threshold}%). Re-submit with acknowledgeShortfall: true to proceed.`,
      "YIELD_SHORTFALL",
      422,
    );
  }
}

export class BatchNotFoundError extends CartonError {
  constructor(id: string) {
    super(`Production run not found: ${id}`, "BATCH_NOT_FOUND", 404);
  }
}

export class StockCountError extends CartonError {
  constructor(message: string, code: string, httpStatus: number) {
    super(message, code, httpStatus);
  }
}

export class IntegrityCheckError extends CartonError {
  constructor(message: string) {
    super(message, "INTEGRITY_CHECK_ERROR", 500);
  }
}