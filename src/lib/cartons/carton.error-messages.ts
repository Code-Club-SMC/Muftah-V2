import type { CartonError } from "./carton.errors";

const ERROR_MESSAGES: Record<string, string> = {
  CARTON_NOT_FOUND: "The requested carton could not be found.",
  CARTON_LOCKED:
    "This carton cannot be modified because it has been dispatched or retired.",
  CARTON_ON_HOLD:
    "This carton is on QC hold. Contact the Quality team to proceed.",
  CAPACITY_EXCEEDED: "Adding packs would exceed the carton's capacity.",
  INSUFFICIENT_PACKS: "Not enough packs in this carton to perform this action.",
  CROSS_SKU_FORBIDDEN: "Cannot transfer packs between cartons of different SKUs.",
  INSUFFICIENT_PERMISSION:
    "You don't have permission to perform this action.",
  CARTON_DISPATCHED:
    "This carton has been dispatched. Use the Returns flow to adjust it.",
  INTEGRITY_VIOLATION: "A data integrity issue was detected. Please contact support.",
  YIELD_SHORTFALL:
    "The batch yield is below the minimum threshold. Acknowledge the shortfall to proceed.",
  BATCH_CLOSED: "This production run is closed and cannot be modified.",
  BATCH_NOT_FOUND: "The requested production run could not be found.",
  BATCH_ALREADY_CLOSED: "This production run is already closed.",
  BATCH_NOT_CLOSED: "This production run is not closed and cannot be reopened.",
  INTEGRITY_CHECK_ERROR: "An error occurred while running the integrity check.",
  STOCK_COUNT_NOT_OPEN: "This stock count session is not open for editing.",
  STOCK_COUNT_ALREADY_SUBMITTED:
    "This stock count session has already been submitted.",
  DISPATCH_ORDER_NOT_FOUND: "The dispatch order could not be found.",
};

export function getCartonErrorMessage(error: CartonError): string {
  return ERROR_MESSAGES[error.code] ?? error.message;
}

export function getErrorCodeMessage(code: string): string {
  return ERROR_MESSAGES[code] ?? "An unexpected error occurred.";
}