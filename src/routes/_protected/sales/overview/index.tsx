import { createFileRoute, Link } from "@tanstack/react-router";
import { Suspense, useState } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { Separator } from "@/components/ui/separator";
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import { type DateRange } from "react-day-picker";
import { format, startOfMonth, endOfMonth } from "date-fns";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useQuery } from "@tanstack/react-query";
import { getSalesOverviewFn } from "@/server-functions/sales/sales-config-fn";
import {
  BarChart3,
  TrendingUp,
  Package,
  Users,
  Store,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react";
import { cn } from "@/lib/utils";

const PKR = (v: number) =>
  `PKR ${v.toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;

export const Route = createFileRoute("/_protected/sales/overview/")({
  component: SalesOverviewPage,
});

function SalesOverviewPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Sales Overview</h1>
        <p className="text-muted-foreground mt-1">
          Product-wise sales performance and breakdown.
        </p>
      </div>
      <Separator />
      <Suspense fallback={<GenericLoader title="Loading Overview" description="Fetching sales data..." />}>
        <SalesOverviewContent />
      </Suspense>
    </div>
  );
}

function SalesOverviewContent() {
  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });

  const dateFrom = dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : undefined;
  const dateTo = dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : undefined;

  const { data, isLoading } = useQuery({
    queryKey: ["sales-overview", dateFrom, dateTo],
    queryFn: () => getSalesOverviewFn({ data: { dateFrom, dateTo } }),
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const products = data?.products || [];
  const totalRevenue = data?.totalRevenue || 0;
  const totalInvoices = data?.totalInvoices || 0;
  const totalProfit = data?.totalProfit || 0;
  const previousRevenue = data?.previousRevenue || 0;
  const previousInvoices = data?.previousInvoices || 0;
  const previousProfit = data?.previousProfit || 0;
  const customerTypeBreakdown = data?.customerTypeBreakdown || [];
  const topCustomers = data?.topCustomers || [];
  const topSalesmen = data?.topSalesmen || [];

  const revenueChange = previousRevenue > 0 ? ((totalRevenue - previousRevenue) / previousRevenue) * 100 : 0;
  const invoiceChange = previousInvoices > 0 ? ((totalInvoices - previousInvoices) / previousInvoices) * 100 : 0;
  const profitChange = previousProfit > 0 ? ((totalProfit - previousProfit) / previousProfit) * 100 : 0;

  return (
    <div className="space-y-5">
      {/* Date Filter */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Period</p>
          <DatePickerWithRange
            date={dateRange}
            onDateChange={(d) => setDateRange(d ?? { from: startOfMonth(new Date()), to: endOfMonth(new Date()) })}
            className="w-64"
          />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total Revenue"
          value={PKR(totalRevenue)}
          icon={TrendingUp}
          theme="emerald"
          change={revenueChange}
        />
        <KpiCard
          label="Invoices"
          value={totalInvoices.toLocaleString()}
          icon={BarChart3}
          theme="blue"
          change={invoiceChange}
        />
        <KpiCard
          label="Total Profit"
          value={PKR(totalProfit)}
          icon={TrendingUp}
          theme="emerald"
          change={profitChange}
        />
        <KpiCard
          label="Products Sold"
          value={products.length.toLocaleString()}
          icon={Package}
          theme="violet"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Products Table */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Package className="size-4" />
              Product Performance
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[11px]">Product</TableHead>
                    <TableHead className="text-[11px] text-right">Cartons</TableHead>
                    <TableHead className="text-[11px] text-right">Loose Units</TableHead>
                    <TableHead className="text-[11px] text-right">Invoices</TableHead>
                    <TableHead className="text-[11px] text-right">Revenue</TableHead>
                    <TableHead className="text-[11px] text-right">Profit</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-10 text-sm">
                        No sales data for the selected period.
                      </TableCell>
                    </TableRow>
                  ) : (
                    products.map((p) => (
                      <TableRow key={p.name}>
                        <TableCell className="text-sm font-medium">{p.name}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums">{p.totalCartons}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums">{p.totalUnits}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums">{p.invoiceCount}</TableCell>
                        <TableCell className="text-sm text-right tabular-nums font-semibold">{PKR(p.revenue)}</TableCell>
                        <TableCell className={cn("text-sm text-right tabular-nums font-semibold", (p.profit ?? 0) >= 0 ? "text-emerald-600" : "text-destructive")}>
                          {PKR(p.profit ?? 0)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {/* Side Stats */}
        <div className="space-y-6">
          {/* Customer Type Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Store className="size-4" />
                Revenue by Customer Type
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!customerTypeBreakdown.length ? (
                <p className="text-sm text-muted-foreground">No data.</p>
              ) : (
                <div className="space-y-3">
                  {customerTypeBreakdown.map((c) => (
                    <div key={c.customerType} className="flex items-center justify-between">
                      <span className="text-sm capitalize">{c.customerType.replace("_", " ")}</span>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums">{PKR(c.revenue)}</p>
                        <p className="text-[10px] text-muted-foreground">{c.invoiceCount} invoices</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Customers */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="size-4" />
                Top Customers
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!topCustomers.length ? (
                <p className="text-sm text-muted-foreground">No data.</p>
              ) : (
                <div className="space-y-3">
                  {topCustomers.map((c) => (
                    <Link
                      key={c.id}
                      to="/sales/customers/$customerId"
                      params={{ customerId: c.id }}
                      search={{ page: 1 }}
                      className="flex items-center justify-between group"
                    >
                      <span className="text-sm group-hover:underline">{c.name}</span>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums">{PKR(c.revenue)}</p>
                        <p className="text-[10px] text-muted-foreground">{c.invoiceCount} invoices</p>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top Salesmen */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="size-4" />
                Top Salesmen
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!topSalesmen.length ? (
                <p className="text-sm text-muted-foreground">No data.</p>
              ) : (
                <div className="space-y-3">
                  {topSalesmen.map((s) => (
                    <div key={s.id} className="flex items-center justify-between">
                      <span className="text-sm">{s.name}</span>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums">{PKR(s.revenue)}</p>
                        <p className="text-[10px] text-muted-foreground">{s.invoiceCount} invoices</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  icon: Icon,
  theme,
  change,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
  theme: "emerald" | "blue" | "rose" | "violet" | "amber";
  change?: number;
}) {
  const styles = {
    emerald: "border-t-emerald-500 text-emerald-600 bg-emerald-500/10",
    blue: "border-t-blue-500 text-blue-600 bg-blue-500/10",
    rose: "border-t-rose-500 text-rose-600 bg-rose-500/10",
    violet: "border-t-violet-500 text-violet-600 bg-violet-500/10",
    amber: "border-t-amber-500 text-amber-600 bg-amber-500/10",
  };

  const isPositive = (change ?? 0) > 0;
  const isNeutral = (change ?? 0) === 0;

  return (
    <Card className={cn("border-t-2", styles[theme].split(" ")[0])}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase">{label}</p>
            <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
            {change !== undefined && (
              <div className="flex items-center gap-1 mt-1.5">
                {isNeutral ? (
                  <Minus className="size-3 text-muted-foreground" />
                ) : isPositive ? (
                  <ArrowUpRight className="size-3 text-emerald-600" />
                ) : (
                  <ArrowDownRight className="size-3 text-rose-600" />
                )}
                <span className={cn("text-xs font-medium", isNeutral && "text-muted-foreground", isPositive && "text-emerald-600", !isNeutral && !isPositive && "text-rose-600")}>
                  {Math.abs(change).toFixed(1)}% vs previous period
                </span>
              </div>
            )}
          </div>
          <div className={cn("p-2 rounded-lg", styles[theme].split(" ")[2])}>
            <Icon className={cn("size-5", styles[theme].split(" ")[1])} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
