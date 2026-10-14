const money = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
export function formatReportMoney(
  value: number | string | null | undefined,
): string {
  return value == null ? "—" : money.format(Number(value));
}
export function reportCanExport(state: {
  generatedAt?: number;
  draft: boolean;
  loading: boolean;
  error: boolean;
}) {
  return (
    Boolean(state.generatedAt) && !state.draft && !state.loading && !state.error
  );
}
export function reportGenerationAction(applied: unknown, next: unknown) {
  return JSON.stringify(applied) === JSON.stringify(next) ? "refetch" : "apply";
}
