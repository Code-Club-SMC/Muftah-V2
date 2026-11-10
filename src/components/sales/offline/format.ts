export function dateTime(value: Date | string) {
  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  }).format(new Date(value));
}

export function batchSource(filename: string) {
  return filename.endsWith(".json") ? "Backup file" : "Offline desk";
}

export function batchStatusLabel(status: string) {
  const labels: Record<string, string> = {
    uploaded: "Uploaded",
    preview_ready: "Ready for review",
    posting: "Posting",
    completed: "Completed",
    completed_with_issues: "Completed with issues",
    rejected: "Rejected",
  };
  return labels[status] ?? status.replaceAll("_", " ");
}
