import { useGetInvoiceStats } from "@/hooks/sales/use-invoices";
import {
  ReceiptText,
  TrendingUp,
  AlertCircle,
  Calculator,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

const PKR = (v: number) =>
  `PKR ${v.toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

interface Props {
  filters?: {
    dateFrom?: string;
    dateTo?: string;
    status?: "paid" | "credit" | "partial";
    customerType?: "distributor" | "retailer";
    warehouseId?: string;
    amountMin?: number;
    amountMax?: number;
  };
}

const cards: {
  key: "totalInvoices" | "totalRevenue" | "totalOutstanding" | "averageInvoiceValue";
  label: string;
  icon: React.ElementType;
  format: (v: number) => string;
  theme: KPITheme;
}[] = [
  {
    key: "totalInvoices",
    label: "Total Invoices",
    icon: ReceiptText,
    format: (v: number) => v.toLocaleString(),
    theme: "blue",
  },
  {
    key: "totalRevenue",
    label: "Revenue",
    icon: TrendingUp,
    format: PKR,
    theme: "emerald",
  },
  {
    key: "totalOutstanding",
    label: "Outstanding Credit",
    icon: AlertCircle,
    format: PKR,
    theme: "rose",
  },
  {
    key: "averageInvoiceValue",
    label: "Avg Invoice Value",
    icon: Calculator,
    format: PKR,
    theme: "amber",
  },
];

type KPITheme = "blue" | "rose" | "emerald" | "violet" | "amber";

const sharpThemeStyles = {
  blue: {
    border: "border-t-blue-500",
    iconBg: "bg-blue-500/10",
    iconText: "text-blue-500",
  },
  rose: {
    border: "border-t-rose-500",
    iconBg: "bg-rose-500/10",
    iconText: "text-rose-500",
  },
  emerald: {
    border: "border-t-emerald-500",
    iconBg: "bg-emerald-500/10",
    iconText: "text-emerald-500",
  },
  violet: {
    border: "border-t-violet-500",
    iconBg: "bg-violet-500/10",
    iconText: "text-violet-500",
  },
  amber: {
    border: "border-t-amber-500",
    iconBg: "bg-amber-500/10",
    iconText: "text-amber-500",
  },
};

export const InvoiceKpiCards = ({ filters }: Props) => {
  const { data: stats } = useGetInvoiceStats(filters);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        const value = stats[card.key] as number;
        const styles = sharpThemeStyles[card.theme];

        return (
          <motion.div
            key={card.key}
            whileHover={{ y: -2, transition: { duration: 0.2 } }}
            className={cn(
              "relative flex flex-col justify-between p-5 bg-card border border-border rounded-none shadow-none",
              "border-t-2",
              styles.border,
            )}
          >
            <div
              className="absolute inset-0 opacity-[0.02] dark:opacity-[0.04] pointer-events-none"
              style={{
                backgroundImage:
                  "linear-gradient(currentColor 1px, transparent 1px), linear-gradient(90deg, currentColor 1px, transparent 1px)",
                backgroundSize: "8px 8px",
              }}
            />

            <div className="relative z-10 flex items-start justify-between mb-8">
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {card.label}
              </p>
              <div className={cn("p-1.5 rounded-none", styles.iconBg)}>
                <Icon className={cn("size-4", styles.iconText)} />
              </div>
            </div>

            <div className="relative z-10 space-y-1">
              <h3 className={cn("text-3xl font-bold tracking-tight text-foreground tabular-nums", styles.iconText)}>
                {card.format(value ?? 0)}
              </h3>
              <div className="h-4" />
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};
