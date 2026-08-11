import { createFileRoute, Link } from "@tanstack/react-router";
import {
  TrendingUp,
  BadgeDollarSign,
  HandCoins,
  Users,
  ShoppingCart,
  Banknote,
  BarChart3,
} from "lucide-react";
import { OfflineReportPendingBanner } from "@/components/reports/offline-report-pending-banner";

const reportTypes = [
  {
    title: "Company Profitability",
    description:
      "Company-wide profitability with product and recipe drill-down reports.",
    href: "/reports/profit-loss",
    icon: BarChart3,
  },
  {
    title: "Sales",
    description: "Invoice totals, paid amounts, and outstanding amounts.",
    href: "/reports/sales",
    icon: TrendingUp,
  },
  {
    title: "Collections",
    description: "Confirmed, pending, and exception payments by method.",
    href: "/reports/collections",
    icon: HandCoins,
  },
  {
    title: "Outstanding",
    description: "Invoices with amounts still waiting to be paid.",
    href: "/reports/outstanding",
    icon: BadgeDollarSign,
  },
  {
    title: "Salaries",
    description: "Payslip data with earnings, deductions, and net pay.",
    href: "/reports/salaries",
    icon: Users,
  },
  {
    title: "Purchases",
    description: "Supplier purchases with material details and payment status.",
    href: "/reports/purchases",
    icon: ShoppingCart,
  },
  {
    title: "Expenses",
    description: "Finance expenses and manufacturing costs.",
    href: "/reports/expenses",
    icon: Banknote,
  },
];

export const Route = createFileRoute("/_protected/reports/")({
  component: ReportsLandingPage,
});

function ReportsLandingPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate operational reports for any date range.
        </p>
      </div>

      <OfflineReportPendingBanner />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {reportTypes.map((report) => {
          const Icon = report.icon;
          return (
            <Link
              key={report.href}
              to={report.href}
              className="group rounded-lg border p-4 hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-md bg-muted p-2">
                  <Icon className="size-4 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-medium text-sm">{report.title}</h3>
                  <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                    {report.description}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
