import { useSuspenseQuery } from "@tanstack/react-query";
import { getEmployeePayrollHistoryFn } from "@/server-functions/hr/payroll/dashboard-fn";
import { format, parseISO, getYear, subMonths } from "date-fns";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    ChevronLeft,
    FileText,
    Wallet,
    Calendar,
    TrendingDown,
    Clock,
    ArrowUpRight,
    Printer,
    History,
    Activity,
    Check,
    Edit2Icon,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { PayslipDialog } from "@/components/hr/payroll/payslip-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { PayslipData } from "@/components/hr/payroll/payslip-view";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { OverrideBradfordDialog } from "../payroll/override-bradford-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// ── Print helpers ─────────────────────────────────────────────────────────

function pkr(n: number) {
    return `PKR ${Math.round(n).toLocaleString("en-US")}`;
}

function buildHistoryReportHTML(
    history: any[],
    employee: any,
    stats: { totalPaid: number; avgSalary: number; totalDeductions: number },
    filterLabel: string,
) {
    const empName =
        `${employee?.firstName ?? ""} ${employee?.lastName ?? ""}`.trim();
    const now = format(new Date(), "dd MMM yyyy, hh:mm a");

    const rows = history
        .map((p) => {
            const month = p.payroll
                ? format(parseISO(p.payroll.month), "MMMM yyyy")
                : "—";
            const period = p.payroll
                ? `${format(parseISO(p.payroll.startDate), "dd MMM")} – ${format(parseISO(p.payroll.endDate), "dd MMM")}`
                : "—";
            const gross = Math.round(parseFloat(p.grossSalary || "0"));
            const deductions = Math.round(parseFloat(p.totalDeductions || "0"));
            const net = Math.round(parseFloat(p.netSalary || "0"));
            const present = p.daysPresent ?? 0;
            const absent = p.daysAbsent ?? 0;

            return `
        <tr>
          <td>${month}</td>
          <td style="color:#64748b;font-size:11px;">${period}</td>
          <td class="num">${present}d / ${absent + present}d</td>
          <td class="num">PKR ${gross.toLocaleString()}</td>
          <td class="num" style="color:#be123c;">${deductions > 0 ? `-PKR ${deductions.toLocaleString()}` : "—"}</td>
          <td class="num" style="color:#15803d;font-weight:800;">PKR ${net.toLocaleString()}</td>
        </tr>`;
        })
        .join("");

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Payroll History — ${empName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 13px; color: #1e293b; padding: 32px 40px; background: #fff; }
    .header { display: flex; align-items: flex-start; justify-content: space-between; border-bottom: 3px solid #1e293b; padding-bottom: 16px; margin-bottom: 24px; }
    .header-title { font-size: 22px; font-weight: 900; color: #0f172a; }
    .header-sub  { font-size: 12px; color: #64748b; margin-top: 2px; }
    .header-right { text-align: right; font-size: 11px; color: #94a3b8; }
    .header-right .bold { font-size: 13px; font-weight: 700; color: #334155; }
    .emp-card { display: flex; align-items: center; gap: 16px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 18px; margin-bottom: 24px; }
    .emp-avatar { width: 48px; height: 48px; border-radius: 50%; background: #1e293b; color: #fff; font-size: 18px; font-weight: 900; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
    .emp-name { font-size: 17px; font-weight: 800; }
    .emp-sub  { font-size: 11px; color: #64748b; margin-top: 2px; }
    .kpi-strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 24px; }
    .kpi { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px 14px; }
    .kpi-label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #94a3b8; }
    .kpi-value { font-size: 18px; font-weight: 800; margin-top: 4px; }
    .kpi-sub   { font-size: 10px; color: #94a3b8; margin-top: 2px; }
    .green { color: #15803d; } .blue { color: #1d4ed8; } .rose { color: #be123c; }
    .section-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.1em; color: #475569; margin-bottom: 10px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0; }
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: #f1f5f9; }
    th { text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #64748b; padding: 9px 10px; border-bottom: 2px solid #e2e8f0; }
    th.num, td.num { text-align: right; }
    td { padding: 9px 10px; font-size: 12px; border-bottom: 1px solid #f1f5f9; }
    .total-row td { background: #f1f5f9; font-weight: 700; border-top: 2px solid #cbd5e1; }
    .footer { margin-top: 32px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; display: flex; justify-content: space-between; }
    @media print { body { padding: 20px 28px; } @page { margin: 10mm; } }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="header-title">Employee Payroll History Report</div>
      <div class="header-sub">Period: ${filterLabel} · Confidential</div>
    </div>
    <div class="header-right"><div>Generated on</div><div class="bold">${now}</div></div>
  </div>
  <div class="emp-card">
    <div class="emp-avatar">${(employee?.firstName?.[0] ?? "?").toUpperCase()}${(employee?.lastName?.[0] ?? "").toUpperCase()}</div>
    <div>
      <div class="emp-name">${empName}</div>
      <div class="emp-sub">${employee?.designation ?? "—"} &nbsp;•&nbsp; ${employee?.employeeCode ?? "—"} &nbsp;•&nbsp; ${employee?.cnic ?? "N/A"}</div>
    </div>
  </div>
  <div class="kpi-strip">
    <div class="kpi"><div class="kpi-label">Total Net Paid</div><div class="kpi-value green">${pkr(stats.totalPaid)}</div><div class="kpi-sub">Period earnings</div></div>
    <div class="kpi"><div class="kpi-label">Average Monthly Net</div><div class="kpi-value blue">${pkr(stats.avgSalary)}</div><div class="kpi-sub">Over ${history.length} payslip(s)</div></div>
    <div class="kpi"><div class="kpi-label">Total Deductions</div><div class="kpi-value rose">${pkr(stats.totalDeductions)}</div><div class="kpi-sub">All adjustments</div></div>
  </div>
  <div class="section-title">Monthly Payroll Breakdown — All Records</div>
  <table>
    <thead><tr><th>Month</th><th>Period</th><th class="num">Attendance</th><th class="num">Gross Pay</th><th class="num">Deductions</th><th class="num">Net Pay</th></tr></thead>
    <tbody>
      ${rows}
      <tr class="total-row">
        <td colspan="3">Total (${history.length} months)</td>
        <td class="num">—</td>
        <td class="num rose">-PKR ${Math.round(stats.totalDeductions).toLocaleString()}</td>
        <td class="num green">PKR ${Math.round(stats.totalPaid).toLocaleString()}</td>
      </tr>
    </tbody>
  </table>
  <div class="footer"><div>System-generated — no signature required.</div><div>Titan ERP · ${now}</div></div>
</body>
</html>`;
}

type EmployeePayrollHistoryContainerProps = {
    employeeId: string;
}

export function EmployeePayrollHistoryContainer({ employeeId }: EmployeePayrollHistoryContainerProps) {
    // ── Filter state ─────────────────────────────────────────────────────────
    // "pending" = what the user is currently selecting
    // "applied" = what the query actually uses (only changes on Apply)
    type FilterMode = "last12" | "year";
    type AppliedFilter = { mode: FilterMode; year?: number };
    const [isOverrideOpen, setIsOverrideOpen] = useState(false);
    const [overrideTarget, setOverrideTarget] = useState<{
        payslipId: string | null;
        currentScore: string;
    } | null>(null);
    const [isPopupBlockedOpen, setIsPopupBlockedOpen] = useState(false);
    const currentYear = new Date().getFullYear();
    const [pendingMode, setPendingMode] = useState<FilterMode>("last12");
    const [pendingYear, setPendingYear] = useState<number>(currentYear);
    const [appliedFilter, setAppliedFilter] = useState<AppliedFilter>({
        mode: "last12",
        year: undefined,
    });

    const isDirty =
        pendingMode !== appliedFilter.mode ||
        (pendingMode === "year" && pendingYear !== appliedFilter.year);

    const handleApply = () => {
        setAppliedFilter({
            mode: pendingMode,
            year: pendingMode === "year" ? pendingYear : undefined,
        });
    };

    // ── Query — key includes applied filter so it refetches on Apply ─────────
    const { data: { employee, history, auditLogs } } = useSuspenseQuery({
        queryKey: [
            "employee-payroll-history",
            employeeId,
            appliedFilter.mode,
            appliedFilter.year,
        ],
        queryFn: () =>
            getEmployeePayrollHistoryFn({
                data: {
                    employeeId,
                    filterMode: appliedFilter.mode,
                    year: appliedFilter.year,
                },
            }),
        staleTime: 0,
        gcTime: 0
    });

    // ── Available years — derived from employee's joining date ───────────────
    const joiningYear = employee?.joiningDate
        ? getYear(parseISO(employee.joiningDate))
        : currentYear;
    const availableYears = Array.from(
        { length: currentYear - joiningYear + 1 },
        (_, i) => currentYear - i,
    );

    // ── Bradford KPI — latest payslip's effective score ───────────────────────
    const latestBradfordScore =
        history.length > 0
            ? history[0].bradfordFactorOverride != null
                ? parseFloat(history[0].bradfordFactorOverride)
                : parseFloat(history[0].bradfordFactorScore || "0")
            : 0;

    // ── Stats ─────────────────────────────────────────────────────────────────
    const stats = {
        totalPaid: history.reduce(
            (acc, curr) => acc + parseFloat(curr.netSalary || "0"),
            0,
        ),
        avgSalary:
            history.length > 0
                ? history.reduce(
                    (acc, curr) => acc + parseFloat(curr.netSalary || "0"),
                    0,
                ) / history.length
                : 0,
        totalDeductions: history.reduce(
            (acc, curr) => acc + parseFloat(curr.totalDeductions || "0"),
            0,
        ),
    };

    const filterLabel =
        appliedFilter.mode === "last12"
            ? `${format(subMonths(new Date(), 12), "MMM yyyy")} – ${format(new Date(), "MMM yyyy")}`
            : String(appliedFilter.year ?? currentYear);

    const formatCurrency = (value: number) => Math.round(value).toLocaleString();

    const [selectedPayslip, setSelectedPayslip] = useState<PayslipData | null>(
        null,
    );
    const [isPayslipOpen, setIsPayslipOpen] = useState(false);

    const handleViewPayslip = (payslip: PayslipData) => {
        setSelectedPayslip(payslip);
        setIsPayslipOpen(true);
    };

    const handleDownloadReport = () => {
        const html = buildHistoryReportHTML(history, employee, stats, filterLabel);
        const win = window.open("", "_blank");
        if (!win) {
            setIsPopupBlockedOpen(true);
            return;
        }
        win.document.open();
        win.document.write(html);
        win.document.close();
        setTimeout(() => {
            win.focus();
            win.print();
        }, 500);
    };

    return (
        <div className="space-y-6 pb-10">
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                    <Button
                        variant="outline"
                        size="icon"
                        asChild
                        className="rounded-lg h-9 w-9 shrink-0 shadow-xs hover:bg-primary/5"
                    >
                        <Link to="/hr/payroll">
                            <ChevronLeft className="size-4" />
                        </Link>
                    </Button>
                    <div className="flex items-center gap-3">
                        <Avatar className="h-10 w-10 border border-border">
                            <AvatarFallback className="text-xs font-bold bg-primary/10 text-primary">
                                {employee?.firstName?.[0]}
                                {employee?.lastName?.[0]}
                            </AvatarFallback>
                        </Avatar>
                        <div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <h1 className="text-lg font-bold tracking-tight">
                                    {employee?.firstName} {employee?.lastName}
                                </h1>
                                {employee?.employeeCode && (
                                    <Badge
                                        variant="outline"
                                        className="text-[9px] px-1.5 h-4 bg-primary/5 text-primary border-primary/20"
                                    >
                                        {employee.employeeCode}
                                    </Badge>
                                )}
                            </div>
                            <p className="text-xs text-muted-foreground font-medium">
                                {employee?.designation}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        className="h-9 gap-2"
                        onClick={handleDownloadReport}
                        disabled={history.length === 0}
                    >
                        <Printer className="size-3.5" />
                        <span className="text-[10px] font-bold uppercase ">
                            History Report
                        </span>
                    </Button>
                </div>
            </div>

            {/* ── Filter Bar ── */}
            <div className="flex flex-wrap items-center gap-3 p-4 rounded-xl border bg-secondary">
                {/* Mode toggle */}
                <div className="flex p-1 rounded-lg bg-muted/50 border border-border/50 gap-0.5">
                    {(["last12", "year"] as FilterMode[]).map((mode) => (
                        <button
                            key={mode}
                            type="button"
                            onClick={() => setPendingMode(mode)}
                            className={cn(
                                "px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all duration-150 focus:outline-none",
                                pendingMode === mode
                                    ? "bg-background  text-foreground border border-border/40"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {mode === "last12" ? "Last 12 Months" : "By Year"}
                        </button>
                    ))}
                </div>

                {/* Year selector — only visible in year mode */}
                {pendingMode === "year" && (
                    <Select
                        value={pendingYear.toString()}
                        onValueChange={(val) => setPendingYear(Number(val))}
                    >
                        <SelectTrigger className="w-[110px] h-9 text-[13px] font-medium bg-background border-border/60 rounded-lg">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {availableYears.map((y) => (
                                <SelectItem key={y} value={y.toString()} className="text-[13px]">
                                    {y}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                )}

                {/* Apply button */}
                <Button
                    size="sm"
                    onClick={handleApply}
                    disabled={!isDirty}
                    className="h-9 gap-1.5 ml-auto"
                >
                    <Check className="size-3.5 stroke-[2.5]" />
                    Apply
                </Button>

                {/* Active filter label */}
                <div className="text-[11px] text-muted-foreground font-medium">
                    Showing:{" "}
                    <span className="text-foreground font-semibold">{filterLabel}</span>
                    <span className="ml-2 text-muted-foreground/60">
                        · {history.length} record{history.length !== 1 ? "s" : ""}
                    </span>
                </div>
            </div>

            {/* ── KPI Cards ── */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <KPICard
                    title="Total Net Paid"
                    value={`PKR ${formatCurrency(stats.totalPaid)}`}
                    icon={Wallet}
                    subtext={filterLabel}
                    accentColor="text-emerald-600"
                    accentBg="bg-emerald-50 dark:bg-emerald-950/30"
                />
                <KPICard
                    title="Average Salary"
                    value={`PKR ${formatCurrency(stats.avgSalary)}`}
                    icon={Calendar}
                    subtext={`Across ${history.length} payslip(s)`}
                    accentColor="text-blue-600"
                    accentBg="bg-blue-50 dark:bg-blue-950/30"
                />
                <KPICard
                    title="Total Deductions"
                    value={`PKR ${formatCurrency(stats.totalDeductions)}`}
                    icon={TrendingDown}
                    subtext="Period adjustments"
                    accentColor="text-rose-600"
                    accentBg="bg-rose-50 dark:bg-rose-950/30"
                />
                <KPICard
                    title="Bradford Factor"
                    value={String(latestBradfordScore)}
                    icon={Activity}
                    subtext="Latest cycle (effective)"
                    accentColor="text-amber-600"
                    accentBg="bg-amber-50 dark:bg-amber-950/30"
                />
            </div>

            {/* ── Payroll History Table ── */}
            <div className="border border-border/60 rounded-xl bg-card overflow-hidden">
                <div className="px-6 py-4 border-b border-border/40 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="p-1.5 rounded-lg bg-primary/5">
                            <Clock className="size-4 text-primary" />
                        </div>
                        <div>
                            <h3 className="text-sm font-black uppercase ">
                                Payroll History
                            </h3>
                            <p className="text-[10px] text-muted-foreground">
                                {history.length} monthly salary record
                                {history.length !== 1 ? "s" : ""} · {filterLabel}
                            </p>
                        </div>
                    </div>
                </div>

                <Table>
                    <TableHeader className="bg-muted/30">
                        <TableRow>
                            <TableHead className="text-[10px] font-black uppercase  text-muted-foreground/80 h-11 pl-6">
                                Month
                            </TableHead>
                            <TableHead className="text-[10px] font-black uppercase  text-muted-foreground/80 h-11">
                                Period
                            </TableHead>
                            <TableHead className="text-[10px] font-black uppercase  text-muted-foreground/80 h-11 text-right">
                                Attendance
                            </TableHead>
                            <TableHead className="text-[10px] font-black uppercase  text-muted-foreground/80 h-11 text-right">
                                Gross Pay
                            </TableHead>
                            <TableHead className="text-[10px] font-black uppercase  text-muted-foreground/80 h-11 text-right">
                                Deductions
                            </TableHead>
                            <TableHead className="text-[10px] font-black uppercase  text-muted-foreground/80 h-11 text-right">
                                Net Pay
                            </TableHead>
                            <TableHead className="text-[10px] font-black uppercase  text-muted-foreground/80 h-11 text-center pr-6">
                                Slip
                            </TableHead>

                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {history.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={7} className="h-40 text-center">
                                    <div className="flex flex-col items-center justify-center text-muted-foreground gap-1">
                                        <FileText className="size-7 mb-1 opacity-20" />
                                        <p className="text-xs font-bold">No records for this period</p>
                                        <p className="text-[10px] opacity-60">
                                            Try switching to a different year or "Last 12 Months".
                                        </p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            <>
                                {history.map((payslip) => (
                                    <TableRow key={payslip.id} className="hover:bg-muted/20">
                                        <TableCell className="pl-6 py-3">
                                            <span className="text-xs font-bold text-foreground">
                                                {payslip.payroll
                                                    ? format(parseISO(payslip.payroll.month), "MMMM yyyy")
                                                    : "—"}
                                            </span>
                                        </TableCell>
                                        <TableCell className="py-3">
                                            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                                                {payslip.payroll
                                                    ? `${format(parseISO(payslip.payroll.startDate), "dd MMM")} – ${format(parseISO(payslip.payroll.endDate), "dd MMM")}`
                                                    : "—"}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right py-3">
                                            <span className="text-xs font-medium text-muted-foreground">
                                                <span className="text-foreground font-bold">
                                                    {payslip.daysPresent ?? 0}
                                                </span>
                                                <span className="opacity-50">
                                                    {" "}
                                                    /{" "}
                                                    {(payslip.daysPresent ?? 0) +
                                                        (payslip.daysAbsent ?? 0)}
                                                    d
                                                </span>
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right py-3">
                                            <span className="text-xs font-medium text-muted-foreground">
                                                {formatCurrency(parseFloat(payslip.grossSalary))}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right py-3">
                                            {parseFloat(payslip.totalDeductions) > 0 ? (
                                                <span className="text-xs font-bold text-rose-600">
                                                    -{formatCurrency(parseFloat(payslip.totalDeductions))}
                                                </span>
                                            ) : (
                                                <span className="text-xs font-medium text-muted-foreground/50">
                                                    —
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right py-3">
                                            <span className="text-xs font-black text-emerald-600">
                                                PKR {formatCurrency(parseFloat(payslip.netSalary))}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-center pr-6 py-3">
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="h-8 w-8 hover:bg-primary/5 hover:text-primary transition-colors"
                                                onClick={() => handleViewPayslip(payslip)}
                                            >
                                                <ArrowUpRight className="size-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {/* Totals row */}
                                <TableRow className="bg-muted/40 border-t-2">
                                    <TableCell colSpan={3} className="pl-6 py-3">
                                        <span className="text-xs font-black uppercase tracking-wide">
                                            Total ({history.length} months)
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right py-3">
                                        <span className="text-xs font-bold">—</span>
                                    </TableCell>
                                    <TableCell className="text-right py-3">
                                        <span className="text-xs font-black text-rose-600">
                                            -{formatCurrency(stats.totalDeductions)}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right py-3">
                                        <span className="text-sm font-black text-emerald-600">
                                            PKR {formatCurrency(stats.totalPaid)}
                                        </span>
                                    </TableCell>
                                    <TableCell />
                                </TableRow>

                            </>
                        )}
                    </TableBody>
                </Table>
            </div>

            {/* ── Bradford Audit Logs ── */}
            {auditLogs && auditLogs.length > 0 && (
                <div className="border border-border/60 rounded-xl bg-card overflow-hidden">
                    <div className="px-6 py-4 border-b border-border/40 flex items-center">
                        <div className="flex items-center gap-2">
                            <div className="p-1.5 rounded-lg bg-amber-500/10">
                                <History className="size-4 text-amber-600 dark:text-amber-500" />
                            </div>
                            <div>
                                <h3 className="text-sm font-black uppercase  text-amber-900 dark:text-amber-100">
                                    Bradford Factor Audit Logs
                                </h3>
                                <p className="text-[10px] text-muted-foreground">
                                    History of manual factor adjustments · {filterLabel}
                                </p>
                            </div>
                        </div>
                    </div>
                    <Table>
                        <TableHeader className="bg-muted/30">
                            <TableRow>
                                <TableHead className="text-[10px] font-black uppercase  text-muted-foreground/80 h-11 pl-6">
                                    Date
                                </TableHead>
                                <TableHead className="text-[10px] font-black uppercase  text-muted-foreground/80 h-11">
                                    Payroll Month
                                </TableHead>
                                <TableHead className="text-[10px] font-black uppercase  text-muted-foreground/80 h-11">
                                    Scores (Auto → Override)
                                </TableHead>
                                <TableHead className="text-[10px] font-black uppercase  text-muted-foreground/80 h-11">
                                    Reason
                                </TableHead>
                                <TableHead className="text-[10px] font-black uppercase  text-muted-foreground/80 h-11 text-right pr-6">
                                    Performed By
                                </TableHead>
                                <TableHead className="text-[10px] font-black uppercase  text-muted-foreground/80 h-11 text-right pr-6">
                                    Action
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {auditLogs.map((log) => (
                                <TableRow key={log.id} className="hover:bg-muted/20">
                                    <TableCell className="pl-6 py-3">
                                        <span className="text-xs font-medium text-foreground">
                                            {format(new Date(log.performedAt), "dd MMM yyyy, hh:mm a")}
                                        </span>
                                    </TableCell>
                                    <TableCell className="py-3">
                                        <span className="text-xs font-medium text-muted-foreground">
                                            {log.payslip?.payroll?.month
                                                ? format(parseISO(log.payslip.payroll.month), "MMMM yyyy")
                                                : "—"}
                                        </span>
                                    </TableCell>
                                    <TableCell className="py-3">
                                        <div className="flex items-center gap-2">
                                            <Badge
                                                variant="outline"
                                                className="text-[10px] px-1.5 h-5 bg-muted"
                                            >
                                                {log.computedScore}
                                            </Badge>
                                            <span className="text-[10px] text-muted-foreground">→</span>
                                            <Badge className="text-[10px] px-1.5 h-5 bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-800">
                                                {log.overrideScore}
                                            </Badge>
                                        </div>
                                    </TableCell>
                                    {/* Truncated reason with tooltip for long text */}
                                    <TableCell className="py-3 max-w-[200px]">
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <span className="text-xs text-muted-foreground truncate block cursor-help max-w-[180px]">
                                                        {log.reason}
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent
                                                    side="left"
                                                    className="max-w-[300px] text-xs bg-background text-foreground border border-border "
                                                >
                                                    {log.reason}
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </TableCell>
                                    <TableCell className="text-right pr-6 py-3">
                                        <span className="text-xs font-bold text-foreground">
                                            {log.performer?.name || "System"}
                                        </span>
                                    </TableCell>
                                    <TableCell className="text-right pr-6 py-3">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-muted-foreground hover:text-amber-600 hover:bg-amber-50 transition-colors"
                                            title="Create new override for this payslip"
                                            onClick={() => {
                                                setOverrideTarget({
                                                    payslipId: log.payslipId,
                                                    currentScore: log.overrideScore,
                                                });
                                                setIsOverrideOpen(true);
                                            }}
                                        >
                                            <Edit2Icon className="size-3.5" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            )}
            {overrideTarget?.payslipId && (
                <OverrideBradfordDialog
                    open={isOverrideOpen}
                    onOpenChange={setIsOverrideOpen}
                    payslipId={overrideTarget.payslipId}
                    currentScore={overrideTarget.currentScore}
                />
            )}
            <PayslipDialog
                open={isPayslipOpen}
                onOpenChange={setIsPayslipOpen}
                payslip={selectedPayslip}
            />

            <AlertDialog open={isPopupBlockedOpen} onOpenChange={setIsPopupBlockedOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Popup Blocked</AlertDialogTitle>
                        <AlertDialogDescription>
                            Your browser has blocked the print popup. Please allow popups for this site to view and print the payroll history report.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogAction onClick={() => setIsPopupBlockedOpen(false)}>
                            Understood
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

// ── KPI Card ──────────────────────────────────────────────────────────────

function KPICard({
    title,
    value,
    subtext,
    icon: Icon,
    accentColor,
    accentBg,
}: {
    title: string;
    value: string;
    subtext: string;
    icon: any;
    accentColor: string;
    accentBg: string;
}) {
    return (
        <Card
            className={cn(
                "border border-border/60 rounded-xl overflow-hidden transition-all",
                accentBg,
            )}
        >
            <CardContent className="p-5">
                <div className="flex items-start justify-between mb-3">
                    <div className="p-2 rounded-lg bg-white/60 dark:bg-black/20 transition-colors">
                        <Icon className={cn("size-4", accentColor)} />
                    </div>
                </div>
                <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase  mb-1 opacity-80">
                        {title}
                    </p>
                    <h3 className={cn("text-2xl font-black tracking-tight", accentColor)}>
                        {value}
                    </h3>
                    <p className="text-[10px] font-medium text-muted-foreground/70 mt-1">
                        {subtext}
                    </p>
                </div>
            </CardContent>
        </Card>
    );
}
