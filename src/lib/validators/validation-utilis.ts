import { type ZodError } from "zod";

/**
 * Extracts the first error message from a Zod error
 */
export function getFirstZodError(error: ZodError): string {
  const firstError = error.issues[0];
  return firstError?.message || "Validation failed";
}

/**
 * Converts Zod validation errors to a user-friendly format
 */
export function formatZodErrors(error: ZodError) {
  return error.issues.map((err) => ({
    field: err.path.join("."),
    message: err.message,
  }));
}

/**
 * Gets all errors for a specific field path
 */
export function getFieldErrors(error: ZodError, fieldPath: string): string[] {
  return error.issues
    .filter((issue) => issue.path.join(".") === fieldPath)
    .map((issue) => issue.message);
}

/**
 * Validates a numeric string value
 */
export function isValidNumber(value: string): boolean {
  const parsed = parseFloat(value);
  return !isNaN(parsed) && parsed > 0;
}

/**
 * Validates a non-empty string
 */
export function isValidString(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validates quantity within reasonable bounds
 */
export function isReasonableQuantity(
  quantity: number,
  max: number = 999999,
): boolean {
  return quantity > 0 && quantity <= max;
}
