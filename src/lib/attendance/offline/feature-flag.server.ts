export function isOfflineAttendanceEnabled() {
  return process.env.OFFLINE_ATTENDANCE_IMPORT_ENABLED === "true";
}

export function requireOfflineAttendanceEnabled() {
  if (!isOfflineAttendanceEnabled()) {
    throw new Error("Offline attendance import is disabled");
  }
}
