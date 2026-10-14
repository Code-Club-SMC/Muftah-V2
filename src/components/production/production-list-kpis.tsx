import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function ProductionListKpis({
  items,
}: {
  items: { label: string; value: string | number; description: string }[];
}) {
  return (
    <div
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4"
      aria-label="Filtered production KPIs"
    >
      {items.map((item) => (
        <Card key={item.label} size="sm">
          <CardHeader>
            <CardTitle>{item.label}</CardTitle>
            <CardDescription>{item.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tabular-nums">{item.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function productionPercentage(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`;
}
