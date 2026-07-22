import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const TYPE_LABELS: Record<string, string> = {
  distributor: "Distributor Invoice",
  retailer: "General Invoice",
  shopkeeper: "General Invoice",
  wholesaler: "General Invoice",
};

const TYPE_STYLES: Record<string, string> = {
  distributor: "border-purple-200 text-purple-700 bg-purple-50 dark:bg-purple-950/20",
  retailer: "border-blue-200 text-blue-700 bg-blue-50 dark:bg-blue-950/20",
  shopkeeper: "border-amber-200 text-amber-700 bg-amber-50 dark:bg-amber-950/20",
  wholesaler: "border-cyan-200 text-cyan-700 bg-cyan-50 dark:bg-cyan-950/20",
};

export function InvoiceTypeBadge({ customerType }: { customerType: string }) {
  const label = TYPE_LABELS[customerType] || "Invoice";
  const style = TYPE_STYLES[customerType] || "border-gray-200 text-gray-700 bg-gray-50 dark:bg-gray-950/20";

  return (
    <Badge variant="outline" className={cn("capitalize text-xs font-semibold", style)}>
      {label}
    </Badge>
  );
}
