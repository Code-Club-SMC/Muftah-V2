import { AlertTriangle, TrendingDown, AlertCircle } from "lucide-react";

interface LossWarningBannerProps {
  netProfit: number;
  grossMargin: number;
  recipeName?: string;
}

export function LossWarningBanner({ netProfit, grossMargin, recipeName }: LossWarningBannerProps) {
  if (netProfit >= 0) return null;

  const severity = grossMargin < -10 ? "critical" : grossMargin < 0 ? "warning" : "watch";

  const config = {
    critical: {
      bg: "bg-rose-500/10 border-rose-500/30 print:bg-white print:border-black",
      icon: <AlertTriangle className="size-5 text-rose-500 print:text-black" aria-hidden="true" />,
      title: "Critical Loss",
      color: "text-rose-600 print:text-black",
    },
    warning: {
      bg: "bg-rose-500/8 border-rose-500/20 print:bg-white print:border-gray-600",
      icon: <TrendingDown className="size-5 text-rose-500 print:text-black" aria-hidden="true" />,
      title: "Loss Alert",
      color: "text-rose-500 print:text-black",
    },
    watch: {
      bg: "bg-amber-500/8 border-amber-500/20 print:bg-white print:border-gray-500",
      icon: <AlertCircle className="size-5 text-amber-500 print:text-black" aria-hidden="true" />,
      title: "Margin Watch",
      color: "text-amber-500 print:text-black",
    },
  };

  const c = config[severity];

  return (
    <div 
      className={`border rounded-lg p-3 print:p-2 ${c.bg}`} 
      role="alert"
    >
      <div className="flex items-start gap-2">
        <div className="shrink-0 mt-0.5 print:hidden">{c.icon}</div>
        <div className="flex-1 min-w-0">
          <h3 className={`font-bold text-sm ${c.color} print:text-[9pt]`}>
            {c.title}
          </h3>
          <p className="text-xs text-muted-foreground print:text-black print:text-[8pt] mt-0.5">
            {recipeName && <><span className="font-semibold">{recipeName}</span> — </>}
            Gross margin <span className="font-bold">{grossMargin.toFixed(1)}%</span>, net loss PKR {Math.abs(netProfit).toLocaleString("en-PK")}
          </p>
          <div className="mt-1 text-xs text-muted-foreground print:hidden">
            {severity === "critical" && (
              <span className="font-semibold text-rose-600">
                Immediate action required — costs significantly exceed revenue.
              </span>
            )}
            {severity === "warning" && (
              <span>
                Review pricing strategy and production costs to restore profitability.
              </span>
            )}
            {severity === "watch" && (
              <span>
                Margin is thin — monitor closely for further deterioration.
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
