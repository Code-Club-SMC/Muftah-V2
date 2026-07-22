import { Package, Boxes, Banknote } from "lucide-react";
import { formatPKR } from "@/lib/currency-format";

interface ProductKpiCardsProps {
  totalCartons: number;
  totalUnits: number;
  totalRevenue: number;
  isLoading: boolean;
}

export function ProductKpiCards({ totalCartons, totalUnits, totalRevenue, isLoading }: ProductKpiCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-muted/30 rounded-xl border border-border/50 p-5 animate-pulse">
            <div className="h-4 w-24 bg-muted rounded mb-3" />
            <div className="h-8 w-32 bg-muted rounded" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 rounded-xl border border-emerald-500/20 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Boxes className="size-4 text-emerald-500" />
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
            Total Cartons Sold
          </span>
        </div>
        <div className="text-2xl font-black tracking-tight text-emerald-900 dark:text-emerald-100">
          {totalCartons.toLocaleString()}
        </div>
      </div>

      <div className="bg-gradient-to-br from-blue-500/10 to-blue-600/5 rounded-xl border border-blue-500/20 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Package className="size-4 text-blue-500" />
          <span className="text-xs font-bold uppercase tracking-wider text-blue-700 dark:text-blue-300">
            Total Units Sold
          </span>
        </div>
        <div className="text-2xl font-black tracking-tight text-blue-900 dark:text-blue-100">
          {totalUnits.toLocaleString()}
        </div>
      </div>

      <div className="bg-gradient-to-br from-amber-500/10 to-amber-600/5 rounded-xl border border-amber-500/20 p-5">
        <div className="flex items-center gap-2 mb-2">
          <Banknote className="size-4 text-amber-500" />
          <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
            Total Revenue
          </span>
        </div>
        <div className="text-2xl font-black tracking-tight text-amber-900 dark:text-amber-100">
          {formatPKR(totalRevenue)}
        </div>
      </div>
    </div>
  );
}
