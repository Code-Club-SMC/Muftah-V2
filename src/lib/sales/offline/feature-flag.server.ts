/**
 * Offline sales is on by default. Set OFFLINE_SALES_IMPORT_ENABLED=false only
 * if you need to switch it off.
 */
export function isOfflineSalesEnabled() {
  return process.env.OFFLINE_SALES_IMPORT_ENABLED !== "false";
}

export function requireOfflineSalesEnabled() {
  if (!isOfflineSalesEnabled()) {
    throw new Error("Offline sales import is disabled");
  }
}
