import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  useGetDueTodaySlips,
  useGetRecoveryQueue,
  useGetRecoverySummary,
} from "@/hooks/sales/use-credit-recovery";
import {
  usePreviewOverdueSlips,
  useUpdateOverdueSlips,
} from "@/hooks/sales/use-overdue-detection";
import {
  getDueTodaySlipsFn,
  getRecoveryQueueFn,
} from "@/server-functions/sales/credit-recovery-fn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertTriangle,
  Clock,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  ShieldAlert,
  RotateCcw,
} from "lucide-react";
import { RecoveryDetailSheet } from "@/components/sales/recovery/recovery-detail-sheet";

const PKR = (v: number) =>
  `PKR ${v.toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;

type DueTodaySlips = Awaited<ReturnType<typeof getDueTodaySlipsFn>>;
type RecoverySlip = DueTodaySlips["slips"][number];
type RecoveryQueueSlips = Awaited<ReturnType<typeof getRecoveryQueueFn>>;
type RecoveryQueueSlip = RecoveryQueueSlips["slips"][number];

const STATUS_STYLES: Record<string, { variant: "default" | "secondary" | "destructive" | "outline"; color: string }> = {
  pending: { variant: "outline", color: "text-yellow-600 border-yellow-300 bg-yellow-50" },
  in_progress: { variant: "secondary", color: "text-blue-600 border-blue-300 bg-blue-50" },
  partially_paid: { variant: "secondary", color: "text-orange-600 border-orange-300 bg-orange-50" },
  overdue: { variant: "destructive", color: "" },
  defaulted: { variant: "destructive", color: "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/30" },
};

export const Route = createFileRoute("/_protected/sales/recovery/")({
  component: RecoveryPage,
});

function RecoveryPage() {
  const [activeTab, setActiveTab] = useState("due-today");
  const { data: summary, isLoading: summaryLoading } = useGetRecoverySummary();

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Outstanding Recovery</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track overdue invoices, assign recovery staff, and monitor follow-ups.
          </p>
        </div>
        <OverdueCheckButton />
      </div>

      {/* Summary Cards */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard
            title="Due Today"
            value={summary?.dueToday ?? 0}
            icon={<Clock className="size-5 text-amber-500" />}
            alert={!!summary?.dueToday}
          />
          <SummaryCard
            title="Pending"
            value={summary?.statusCounts?.pending ?? 0}
            icon={<AlertCircle className="size-5 text-yellow-500" />}
          />
          <SummaryCard
            title="In Progress"
            value={summary?.statusCounts?.["in_progress"] ?? 0}
            icon={<TrendingUp className="size-5 text-blue-500" />}
          />
          <SummaryCard
            title="Overdue"
            value={summary?.statusCounts?.overdue ?? 0}
            icon={<AlertTriangle className="size-5 text-red-500" />}
            alert={!!summary?.statusCounts?.overdue}
          />
          <SummaryCard
            title="Defaulted"
            value={summary?.statusCounts?.defaulted ?? 0}
            icon={<ShieldAlert className="size-5 text-red-700" />}
          />
          <SummaryCard
            title="Partially Paid"
            value={summary?.statusCounts?.["partially_paid"] ?? 0}
            icon={<CheckCircle2 className="size-5 text-orange-500" />}
          />
          <SummaryCard
            title="Total Outstanding"
            value={PKR(summary?.totalOutstanding ?? 0)}
            icon={<TrendingUp className="size-5 text-emerald-500" />}
            isCurrency
          />
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="due-today" className="gap-2">
            <Clock className="size-3.5" />
            Due Today
            {summary?.dueToday ? (
              <Badge variant="destructive" className="ml-1 text-[10px] px-1.5 py-0">
                {summary.dueToday}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="recovery-queue" className="gap-2">
            <AlertTriangle className="size-3.5" />
            Recovery Queue
          </TabsTrigger>
        </TabsList>

        <TabsContent value="due-today" className="mt-6">
          <DueTodaySection />
        </TabsContent>

        <TabsContent value="recovery-queue" className="mt-6">
          <RecoveryQueueSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function OverdueCheckButton() {
  const { data: preview } = usePreviewOverdueSlips();
  const { mutate: runCheck, isPending } = useUpdateOverdueSlips();
  const count = preview?.overdueCount ?? 0;

  return (
    <Button
      size="sm"
      variant={count > 0 ? "default" : "outline"}
      onClick={() => runCheck()}
      disabled={isPending}
      className="gap-2"
    >
      <RotateCcw className={cn("size-3.5", isPending && "animate-spin")} />
      {count > 0 ? `Mark ${count} overdue` : "Run Overdue Check"}
    </Button>
  );
}

function SummaryCard({
  title,
  value,
  icon,
  alert,
  isCurrency,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  alert?: boolean;
  isCurrency?: boolean;
}) {
  return (
    <Card className={cn(alert && "border-amber-300 dark:border-amber-700")}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-xs font-medium text-muted-foreground">{title}</CardTitle>
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <p className={cn("text-xl font-bold", isCurrency ? "tabular-nums" : "")}>{value}</p>
      </CardContent>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// DUE TODAY SECTION
// ═══════════════════════════════════════════════════════════════════════════

function DueTodaySection() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useGetDueTodaySlips(page, 50);
  const [selectedSlip, setSelectedSlip] = useState<any>(null);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[11px]">Slip</TableHead>
              <TableHead className="text-[11px]">Customer</TableHead>
              <TableHead className="text-[11px]">Type</TableHead>
              <TableHead className="text-[11px]">Due Date</TableHead>
              <TableHead className="text-[11px] text-right">Outstanding Amount</TableHead>
              <TableHead className="text-[11px]">Original Salesman</TableHead>
              <TableHead className="text-[11px]">Assigned To</TableHead>
              <TableHead className="text-[11px]">Status</TableHead>
              <TableHead className="text-[11px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(9)].map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : !data?.slips?.length ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center py-10 text-sm text-muted-foreground">
                  No slips due today. All caught up!
                </TableCell>
              </TableRow>
            ) : (
              data.slips.map((s: RecoverySlip) => (
                <TableRow key={s.id} className={cn(Number(s.outstandingAmount) === 0 && "bg-green-50/50 dark:bg-green-950/10")}>
                  <TableCell className="font-mono text-xs">{s.slipNumber}</TableCell>
                  <TableCell className="text-sm">{s.customer?.name}</TableCell>
                  <TableCell className="text-xs capitalize">{s.customer?.customerType}</TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {s.invoice?.paymentDueDate
                      ? format(new Date(s.invoice.paymentDueDate), "dd MMM yy")
                      : "—"}
                  </TableCell>
                  <TableCell className={cn(
                    "text-sm tabular-nums text-right font-semibold",
                    Number(s.outstandingAmount) === 0 ? "text-green-600" : "text-red-600"
                  )}>
                    {PKR(Number(s.outstandingAmount))}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.salesman?.name ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.recoveryAssignedTo?.name ?? "—"}</TableCell>
                  <TableCell>
                    {Number(s.outstandingAmount) === 0 ? (
                      <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200">
                        Ready to Close
                      </Badge>
                    ) : (
                      <RecoveryStatusBadge status={s.recoveryStatus} />
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelectedSlip(s)}>
                        Manage
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-xs" asChild>
                        <Link to="/sales/reconciliation" search={{ slip: s.slipNumber }}>
                          Reconcile
                        </Link>
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data && data.pageCount > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page} of {data.pageCount}</span>
          <Button variant="outline" size="sm" disabled={page >= data.pageCount} onClick={() => setPage(p => p + 1)}>
            Next
          </Button>
        </div>
      )}

      <RecoveryDetailSheet slip={selectedSlip} onClose={() => setSelectedSlip(null)} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// RECOVERY QUEUE SECTION
// ═══════════════════════════════════════════════════════════════════════════

function RecoveryQueueSection() {
  const [filters, setFilters] = useState({
    recoveryStatus: "" as string,
    assignedToId: "" as string,
    escalationLevel: undefined as number | undefined,
    page: 1,
    limit: 50,
  });
  const { data, isLoading } = useGetRecoveryQueue(filters);
  const [selectedSlip, setSelectedSlip] = useState<any>(null);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <Select
          value={filters.recoveryStatus || undefined}
          onValueChange={(v) => setFilters(f => ({ ...f, recoveryStatus: v === "all" ? "" : v, page: 1 }))}
        >
          <SelectTrigger className="w-[160px] h-8 text-xs">
            <SelectValue placeholder="All Statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="partially_paid">Partially Paid</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
            <SelectItem value="defaulted">Defaulted</SelectItem>
          </SelectContent>
        </Select>

        <EscalationFilter
          value={filters.escalationLevel}
          onChange={(v) => setFilters(f => ({ ...f, escalationLevel: v, page: 1 }))}
        />
      </div>

      <div className="rounded-xl border overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-[11px]">Slip</TableHead>
              <TableHead className="text-[11px]">Customer</TableHead>
              <TableHead className="text-[11px]">Outstanding Amount</TableHead>
              <TableHead className="text-[11px]">Status</TableHead>
              <TableHead className="text-[11px]">Assigned To</TableHead>
              <TableHead className="text-[11px]">Next Follow-up</TableHead>
              <TableHead className="text-[11px]">Escalation</TableHead>
              <TableHead className="text-[11px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              [...Array(5)].map((_, i) => (
                <TableRow key={i}>
                  {[...Array(8)].map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : !data?.slips?.length ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-10 text-sm text-muted-foreground">
                  No slips in recovery queue.
                </TableCell>
              </TableRow>
            ) : (
              data.slips.map((s: RecoveryQueueSlip) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.slipNumber}</TableCell>
                  <TableCell className="text-sm">{s.customer?.name}</TableCell>
                  <TableCell className="text-sm tabular-nums text-right font-semibold text-red-600">
                    {PKR(Number(s.outstandingAmount))}
                  </TableCell>
                  <TableCell><RecoveryStatusBadge status={s.recoveryStatus} /></TableCell>
                  <TableCell className="text-sm text-muted-foreground">{s.recoveryAssignedTo?.name ?? "—"}</TableCell>
                  <TableCell className="text-xs tabular-nums">
                    {s.nextFollowUpDate
                      ? format(new Date(s.nextFollowUpDate), "dd MMM yy")
                      : "—"}
                  </TableCell>
                  <TableCell><EscalationBadge level={s.escalationLevel ?? 0} /></TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelectedSlip(s)}>
                      Manage
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data && data.pageCount > 1 && (
        <div className="flex items-center justify-between">
          <Button variant="outline" size="sm" disabled={filters.page <= 1} onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}>
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {filters.page} of {data.pageCount}</span>
          <Button variant="outline" size="sm" disabled={filters.page >= data.pageCount} onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}>
            Next
          </Button>
        </div>
      )}

      <RecoveryDetailSheet slip={selectedSlip} onClose={() => setSelectedSlip(null)} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SMALL COMPONENTS
// ═══════════════════════════════════════════════════════════════════════════

function RecoveryStatusBadge({ status }: { status: string | null }) {
  if (!status) return <Badge variant="outline" className="text-[10px]">—</Badge>;
  const style = STATUS_STYLES[status] ?? { variant: "outline" as const, color: "" };
  return (
    <Badge variant={style.variant} className={cn("text-[10px] capitalize", style.color)}>
      {status.replace("_", " ")}
    </Badge>
  );
}

function EscalationBadge({ level }: { level: number }) {
  const colors = [
    "bg-slate-100 text-slate-700 border-slate-300",
    "bg-amber-100 text-amber-800 border-amber-300",
    "bg-orange-100 text-orange-800 border-orange-300",
    "bg-red-100 text-red-800 border-red-300",
  ];
  const color = colors[Math.min(level, colors.length - 1)];
  return (
    <Badge variant="outline" className={cn("text-[10px] font-semibold", color)}>
      L{level}
    </Badge>
  );
}

function EscalationFilter({ value, onChange }: { value?: number; onChange: (v?: number) => void }) {
  return (
    <Select value={value === undefined ? undefined : String(value)} onValueChange={(v) => onChange(v === "all" ? undefined : Number(v))}>
      <SelectTrigger className="w-[140px] h-8 text-xs">
        <SelectValue placeholder="All Levels" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Levels</SelectItem>
        <SelectItem value="0">Level 0</SelectItem>
        <SelectItem value="1">Level 1</SelectItem>
        <SelectItem value="2">Level 2</SelectItem>
        <SelectItem value="3">Level 3</SelectItem>
      </SelectContent>
    </Select>
  );
}
