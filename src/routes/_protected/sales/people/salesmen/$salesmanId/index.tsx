import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { type DateRange } from "react-day-picker";
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/components/ui/table";
import { ChevronLeft, AlertCircle, BookOpen, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { getSalesmanSummaryFn } from "@/server-functions/sales/ledger-fn";

const PKR = (v: number) =>
  `PKR ${v.toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;

export const Route = createFileRoute("/_protected/sales/people/salesmen/$salesmanId/")({
  component: SalesmanProfilePage,
});

function SalesmanProfilePage() {
  const { salesmanId } = Route.useParams();
  const router = useRouter();

  const [dateRange, setDateRange] = useState<DateRange>({
    from: startOfMonth(new Date()),
    to: endOfMonth(new Date()),
  });

  const dateFrom = dateRange.from ? format(dateRange.from, "yyyy-MM-dd") : undefined;
  const dateTo = dateRange.to ? format(dateRange.to, "yyyy-MM-dd") : undefined;

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["salesman-summary", salesmanId, dateFrom, dateTo],
    queryFn: () =>
      getSalesmanSummaryFn({
        data: { salesmanId, dateFrom, dateTo },
      }),
  });

  if (isLoading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-24 w-full rounded-lg" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <AlertCircle className="size-12 text-destructive" />
        <p className="text-sm font-medium text-destructive">
          {(error as any)?.message || "Failed to load salesman data"}
        </p>
        <Button variant="outline" onClick={() => router.history.back()}>
          Go Back
        </Button>
      </div>
    );
  }

  if (!data) return null;

  const { salesman, customers, totalSales, totalCredit, totalCash, outstandingBalance } = data;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start gap-4">
        <Button variant="ghost" size="sm" className="gap-1.5 -ml-2" onClick={() => router.history.back()}>
          <ChevronLeft className="size-4" />
          Back
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight truncate">{salesman.name}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {salesman.phone || "—"}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() =>
            router.navigate({
              to: "/sales/people/salesmen/$salesmanId/ledger",
              params: { salesmanId },
            })
          }
        >
          <FileText className="size-4" />
          View Ledger
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Filter Period</p>
          <DatePickerWithRange date={dateRange} onDateChange={(d) => setDateRange(d ?? { from: startOfMonth(new Date()), to: endOfMonth(new Date()) })} className="w-64" />
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">Total Sales</p>
          <p className="text-xl font-bold tabular-nums text-emerald-700">{PKR(totalSales)}</p>
        </div>
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">Cash Collected</p>
          <p className="text-xl font-bold tabular-nums text-blue-700">{PKR(totalCash)}</p>
        </div>
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">Credit</p>
          <p className="text-xl font-bold tabular-nums text-rose-700">{PKR(totalCredit)}</p>
        </div>
        <div className="p-4 rounded-xl border bg-card">
          <p className="text-[10px] font-semibold uppercase text-muted-foreground mb-2">Outstanding</p>
          <p className={cn("text-xl font-bold tabular-nums", outstandingBalance > 0 ? "text-red-700" : "text-green-700")}>
            {PKR(outstandingBalance)}
          </p>
        </div>
      </div>

      {/* Assigned Shops */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Assigned Shops ({customers.length})</h3>
        <div className="rounded-xl border border-border/60 bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[11px]">Shop</TableHead>
                <TableHead className="text-[11px]">Type</TableHead>
                <TableHead className="text-[11px]">City</TableHead>
                <TableHead className="text-[11px] text-right">Outstanding</TableHead>
                <TableHead className="text-[11px] w-[50px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {customers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground py-10 text-sm">
                    No shops assigned.
                  </TableCell>
                </TableRow>
              ) : (
                customers.map((c: any) => (
                  <TableRow key={c.id}>
                    <TableCell className="text-sm font-medium">{c.name}</TableCell>
                    <TableCell className="text-sm capitalize">{c.customerType}</TableCell>
                    <TableCell className="text-sm">{c.city || "—"}</TableCell>
                    <TableCell className="text-sm text-right">
                      {Number(c.outstandingBalance) > 0 ? (
                        <Badge variant="destructive" className="text-[10px] tabular-nums">
                          {PKR(Number(c.outstandingBalance))}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-green-600 border-green-200 text-[10px]">
                          Clear
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() =>
                          router.navigate({
                            to: "/sales/people/salesmen/$salesmanId/shops/$customerId",
                            params: { salesmanId, customerId: c.id },
                          })
                        }
                      >
                        <BookOpen className="size-4 text-muted-foreground" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
