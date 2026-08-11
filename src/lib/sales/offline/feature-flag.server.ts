export function isOfflineSalesEnabled() {
  return process.env.OFFLINE_SALES_IMPORT_ENABLED === "true";
}

export function requireOfflineSalesEnabled() {
  if (!isOfflineSalesEnabled()) {
    throw new Error("Offline sales import is disabled");
  }
}
