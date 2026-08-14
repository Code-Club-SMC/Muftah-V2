import { useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { getMonthlyPayrollTableFn } from "@/server-functions/hr/payroll/dashboard-fn";
import { format, parseISO, differenceInDays, isAfter, isBefore } from "date-fns";
import { useState, useMemo } from "react";
import { motion, Variants } from "framer-motion";
import {
  ColumnDef,
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  flexRender,
} from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SalaryCalculatorSheet } from "@/components/hr/payroll/salary-calculator-sheet";
import { MonthSelector } from "@/components/ui/month-selector";
import {
  Calculator,
  Search,
  Eye,
  Edit,
  CheckCircle2,
  Clock,
  DollarSign,
  Users,
  AlertTriangle,
  AlertCircle,
  ClockAlert,
  CalendarX2,
  TriangleAlert,
  Calendar,
  Timer,
  Banknote,
  TrendingUp,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Link, useRouter } from "@tanstack/react-router";
import { GenericEmpty } from "../../custom/empty";
import { HREmptyIllustration } from "@/components/illustrations/HREmptyIllustration";
import { cn } from "@/lib/utils";
import { getPendingApprovalCountsFn } from "@/server-functions/hr/get-pending-approval-counts-fn";
import { getArrearsMissedCyclesFn } from "@/server-functions/hr/payroll/arrears-fn";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { TooltipWrapper } from "@/components/custom/tooltip-wrapper";
import {
  getCurrentActiveCycle,
  getCycleFromMonthKey,
  isInGracePeriod,
  cycleProgressPercent,
  daysRemainingInCycle,
} from "@/lib/payroll-cycle";

// ── Types ──────────────────────────────────────────────────────────────────

export type EmployeePayrollRow = {
  id: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  designation: string;
  department: string | null;
  joiningDate: string;
  basicSalary: string | null;
  hasPayslip: boolean;
  payslipId: string;
  netSalary: string;
  status: string;
  isEligible: boolean;
  unmarkedDays: number;
  hasPendingOvertimeApprovals: boolean;
  hasPendingLeaveApprovals: boolean;
};

// ── Animation Variants ─────────────────────────────────────────────────────

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.05 },
  },
};

const itemVariants: Variants = {
  hidden: { opacity: 0, y: 15 },
  show: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 30 },
  },
};

// ── Cycle helpers ──────────────────────────────────────────────────────────

type Warning = { label: string; detail: string };

function getEmployeeReadiness(
  employee: EmployeePayrollRow & { missedLastMonth: boolean },
  cycleEnd: Date,
  cycleStart: Date,
  now: Date,
): {
  isCycleOpen: boolean;
  joinedMidCycle: boolean;
  daysUntilEligible: number;
  cycleCloseDate: string;
  warnings: Warning[];
  isReadyToProcess: boolean;
} {
  const isCycleOpen = isAfter(now, cycleEnd);
  const joiningDate = parseISO(employee.joiningDate);
  const joinedMidCycle =
    isAfter(joiningDate, cycleStart) && isBefore(joiningDate, cycleEnd);
  const daysUntilEligible = isCycleOpen ? 0 : differenceInDays(cycleEnd, now) + 1;
  const cycleCloseDate = format(cycleEnd, "dd MMM yyyy");

  const warnings: Warning[] = [];

  if (employee.unmarkedDays > 0) {
    warnings.push({
      label: `${employee.unmarkedDays} Unmarked Day${employee.unmarkedDays !== 1 ? "s" : ""}`,
      detail: `${employee.unmarkedDays} working day${employee.unmarkedDays !== 1 ? "s have" : " has"} no attendance entry. These will count as absent and trigger a full-day salary deduction. Go to Attendance and mark each missing day before processing.`,
    });
  }
  if (employee.hasPendingOvertimeApprovals) {
    warnings.push({
      label: "Overtime Awaiting Approval",
      detail:
        "One or more overtime entries in this cycle are still pending admin sign-off. Unapproved overtime is excluded from the payslip. Approve or reject in the Attendance module first.",
    });
  }
  if (employee.hasPendingLeaveApprovals) {
    warnings.push({
      label: "Leave Request Not Yet Approved",
      detail:
        "A leave request in this cycle is still pending. Until approved, it is treated as unpaid leave, which triggers a conveyance deduction. Resolve it in Attendance → Approvals before generating the slip.",
    });
  }

  return {
    isCycleOpen,
    joinedMidCycle,
    daysUntilEligible,
    cycleCloseDate,
    warnings,
    isReadyToProcess: isCycleOpen,
  };
}

// ── Warning tooltip body (reused in two places) ────────────────────────────

function WarningTooltipBody({ warnings, footer }: { warnings: Warning[]; footer?: string }) {
  return (
    <div className="space-y-3 max-w-[280px]">
      {warnings.map((w, i) => (
        <div key={i} className="space-y-0.5">
          <p className="text-xs font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
            <AlertCircle className="size-3 shrink-0" /> {w.label}
          </p>
          <p className="text-[11px] text-muted-foreground leading-relaxed pl-4">
            {w.detail}
          </p>
        </div>
      ))}
      {footer && (
        <p className="text-[10px] text-muted-foreground border-t border-border/40 pt-2 leading-relaxed">
          {footer}
        </p>
      )}
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export function PayrollContainer() {
  const router = useRouter();
  const activeMonth = getCurrentActiveCycle().payoutMonthKey;
  const [month, setMonth] = useState(activeMonth);
  const [pageIndex, setPageIndex] = useState(0);
  const limit = 7;
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);
  const [isCalculatorOpen, setIsCalculatorOpen] = useState(false);
  const [globalFilter, setGlobalFilter] = useState("");

  const { data } = useSuspenseQuery({
    queryKey: ["payroll-dashboard", month, pageIndex],
    queryFn: () =>
      getMonthlyPayrollTableFn({ data: { month, limit, offset: pageIndex * limit } }),
  });

  const { data: missedCyclesData } = useQuery({
    queryKey: ["payroll-missed-cycles"],
    queryFn: () => getArrearsMissedCyclesFn({ data: { lookbackMonths: 12 } }),
  });

  const employees = data.employees as (EmployeePayrollRow & { missedLastMonth: boolean })[];
  const cycle = getCycleFromMonthKey(month);
  const cycleStart = parseISO(cycle.cycleStart);
  const cycleEnd = parseISO(cycle.cycleEnd);
  const now = new Date();
  const inGrace = isInGracePeriod(now);
  const completionPct = Math.round(
    (data.payslipsGeneratedCount / Math.max(1, data.activeCount)) * 100,
  );
  const totalPages = Math.ceil(data.totalEmployees / limit);

  if (employees.length === 0 && pageIndex === 0 && !globalFilter) {
    return (
      <GenericEmpty
        icon={HREmptyIllustration}
        title="No Employees Found"
        description="There are no active employees to process payroll for this month."
        ctaText="Go to Employees"
        onAddChange={() => router.navigate({ to: "/hr/employees" })}
      />
    );
  }

  const columns: ColumnDef<EmployeePayrollRow & { missedLastMonth: boolean }>[] = useMemo(
    () => [
      {
        accessorKey: "employeeCode",
        header: "Code",
        cell: ({ row }) => (
          <span className="font-mono text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
            {row.original.employeeCode}
          </span>
        ),
      },
      {
        id: "name",
        accessorFn: (row) => `${row.firstName} ${row.lastName}`,
        header: "Employee",
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Avatar className="h-9 w-9 border border-border rounded-none">
              <AvatarFallback className="text-xs font-semibold bg-primary/10 text-primary rounded-none">
                {row.original.firstName[0]}{row.original.lastName[0]}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <span className="font-medium text-sm leading-tight">
                {row.original.firstName} {row.original.lastName}
              </span>
              <span className="text-xs text-muted-foreground">
                {row.original.designation}
              </span>
            </div>
          </div>
        ),
      },
      {
        accessorKey: "basicSalary",
        header: "Basic Salary",
        cell: ({ row }) => (
          <div className="text-right font-medium text-sm">
            PKR {Math.round(parseFloat(row.original.basicSalary || "0")).toLocaleString()}
          </div>
        ),
      },
      {
        id: "cycle_status",
        header: "Cycle Status",
        cell: ({ row }) => {
          const { isCycleOpen, daysUntilEligible, cycleCloseDate, warnings, joinedMidCycle } =
            getEmployeeReadiness(row.original, cycleEnd, cycleStart, now);

          if (!isCycleOpen) {
            return (
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <ClockAlert className="size-3.5 text-amber-500" />
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                    {daysUntilEligible} day{daysUntilEligible !== 1 ? "s" : ""} remaining
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Cycle closes {cycleCloseDate}
                </span>
              </div>
            );
          }

          if (warnings.length === 0) {
            return (
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5 text-emerald-500" />
                  <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                    Ready to process
                  </span>
                </div>
                {joinedMidCycle && (
                  <span className="text-[11px] text-blue-600 font-medium">
                    Mid-cycle joiner
                  </span>
                )}
              </div>
            );
          }

          return (
            <TooltipWrapper
              side="right"
              contentClassName="p-3 bg-background text-foreground border border-border"
              tooltipContent={
                <>
                  <p className="text-xs font-semibold text-foreground mb-2">
                    Cycle open — needs attention
                  </p>
                  <WarningTooltipBody
                    warnings={warnings}
                    footer="Processing now will use current data. These issues may affect net salary accuracy."
                  />
                </>
              }
            >
              <div className="flex flex-col gap-0.5 cursor-help w-fit">
                <div className="flex items-center gap-1.5">
                  <TriangleAlert className="size-3.5 text-amber-500" />
                  <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">
                    {warnings.length} issue{warnings.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  Hover for details
                </span>
              </div>
            </TooltipWrapper>
          );
        },
      },
      {
        accessorKey: "status",
        header: "Payslip",
        cell: ({ row }) => {
          if (row.original.hasPayslip) {
            return (
              <div className="flex flex-col gap-0.5">
                <Badge className="bg-emerald-500 text-white hover:bg-emerald-600 border-none text-[10px] px-2 py-0.5 h-5 font-semibold uppercase tracking-wider w-fit rounded-none">
                  Generated
                </Badge>
                <span className="text-xs font-semibold text-emerald-600">
                  PKR {Math.round(parseFloat(row.original.netSalary)).toLocaleString()}
                </span>
              </div>
            );
          }
          return (
            <div className="flex flex-col gap-1">
              <Badge
                variant="secondary"
                className="bg-muted text-muted-foreground border-none text-[10px] px-2 py-0.5 h-5 font-semibold uppercase tracking-wider w-fit rounded-none"
              >
                Pending
              </Badge>
              {row.original.missedLastMonth && (
                <Badge
                  variant="outline"
                  className="text-[9px] px-1 h-4 bg-amber-50 text-amber-700 border-amber-200 border-dashed w-fit rounded-none"
                >
                  Arrears Potential
                </Badge>
              )}
            </div>
          );
        },
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const emp = row.original;
          const { isReadyToProcess, cycleCloseDate, warnings } =
            getEmployeeReadiness(emp, cycleEnd, cycleStart, now);

          return (
            <div className="flex items-center gap-2 justify-end">
              {emp.hasPayslip ? (
                <TooltipWrapper
                  side="left"
                  contentClassName="p-3 bg-background text-foreground border border-border"
                  tooltipContent={
                    warnings.length > 0 ? (
                      <>
                        <p className="text-xs font-semibold text-amber-600 mb-2">Revising with open issues</p>
                        <WarningTooltipBody warnings={warnings} footer="The revised slip will reflect current attendance data." />
                      </>
                    ) : null
                  }
                >
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 px-3 rounded-none"
                    onClick={() => { setSelectedEmployeeId(emp.id); setIsCalculatorOpen(true); }}
                  >
                    <Edit className="size-3.5" />
                    <span className="text-xs font-semibold">Revise</span>
                  </Button>
                </TooltipWrapper>
              ) : isReadyToProcess ? (
                <TooltipWrapper
                  side="left"
                  contentClassName="p-3 max-w-[230px] bg-background text-foreground border border-border"
                  tooltipContent={
                    warnings.length > 0 ? (
                      <>
                        <p className="text-xs font-semibold text-foreground mb-2">
                          Cycle is open — {warnings.length} item{warnings.length !== 1 ? "s need" : " needs"} attention
                        </p>
                        <WarningTooltipBody warnings={warnings} footer="You can still generate the slip. Unresolved items may cause incorrect deductions or missing overtime pay." />
                      </>
                    ) : null
                  }
                >
                  <Button
                    size="sm"
                    variant="default"
                    className={cn(
                      "h-8 gap-1.5 px-3 rounded-none",
                      warnings.length > 0 && "border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950/30 dark:text-amber-400",
                    )}
                    onClick={() => { setSelectedEmployeeId(emp.id); setIsCalculatorOpen(true); }}
                  >
                    {warnings.length > 0 ? <AlertCircle className="size-3.5 text-amber-500" /> : <Calculator className="size-3.5" />}
                    <span className="text-xs font-semibold">Process</span>
                  </Button>
                </TooltipWrapper>
              ) : (
                <TooltipWrapper
                  side="left"
                  contentClassName="p-3 max-w-[230px] border-amber-200 bg-amber-50 dark:bg-amber-950/90 dark:border-amber-800"
                  tooltipContent={
                    <div className="flex items-start gap-2">
                      <CalendarX2 className="size-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      <div className="space-y-1">
                        <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Process Before Close</p>
                        <p className="text-[11px] text-amber-700/80 dark:text-amber-400/80 leading-relaxed">
                          Cycle closes on <strong className="text-amber-900 dark:text-amber-100">{cycleCloseDate}</strong>. Processing early will generate a payslip based only on attendance recorded up to today.
                        </p>
                      </div>
                    </div>
                  }
                >
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 gap-1.5 px-3 border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700/50 dark:text-amber-400 dark:hover:bg-amber-950/30 rounded-none"
                    onClick={() => { setSelectedEmployeeId(emp.id); setIsCalculatorOpen(true); }}
                  >
                    <ClockAlert className="size-3.5" />
                    <span className="text-xs font-semibold">Process Early</span>
                  </Button>
                </TooltipWrapper>
              )}
              <Button variant="ghost" size="icon" className="h-8 w-8 hover:bg-primary/5 hover:text-primary rounded-none" asChild title="View Payroll History">
                <Link to="/hr/payroll/employee/$employeeId" params={{ employeeId: emp.id }}>
                  <Eye className="size-4" />
                </Link>
              </Button>
            </div>
          );
        },
      },
    ],
    [cycleEnd, cycleStart, now],
  );

  const table = useReactTable({
    data: employees,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    state: { globalFilter },
    onGlobalFilterChange: setGlobalFilter,
  });

  return (
    <motion.div
      variants={containerVariants}
      initial="hidden"
      animate="show"
      className="space-y-6 font-sans antialiased"
    >
      {/* ── Page header ────────────────────────────────────────────────── */}
      <motion.div
        variants={itemVariants}
        className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-none border border-border bg-card px-6 py-5 shadow-none"
      >
        <div className="space-y-1.5">
          <h1 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <div className="p-1.5 bg-primary/10 border border-primary/20">
              <Banknote className="size-4 text-primary" />
            </div>
            Payroll Overview
          </h1>
          <p className="text-[10px] font-bold uppercase text-muted-foreground flex items-center gap-2">
            <span>{data.totalEmployees} employees</span>
            <span>&middot;</span>
            <span className="text-emerald-600 dark:text-emerald-500">{data.activeCount} active</span>
            <span>&middot;</span>
            <span>{data.payslipsGeneratedCount} slip{data.payslipsGeneratedCount !== 1 ? "s" : ""} finalized</span>
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] font-bold uppercase text-muted-foreground whitespace-nowrap">
            Payout Month
          </span>
          <MonthSelector
            value={month}
            onChange={(value) => {
              setMonth(value || activeMonth);
              setPageIndex(0);
            }}
            className="rounded-none h-10"
          />
        </div>
      </motion.div>

      {/* ── Cycle Banner ───────────────────────────────────────────────── */}
      <motion.div variants={itemVariants}>
        <PayrollCycleBanner cycle={cycle} inGrace={inGrace} />
      </motion.div>

      {/* ── Pending Approvals Warning ──────────────────────────────────── */}
      <motion.div variants={itemVariants}>
        <PendingApprovalsWarning />
      </motion.div>

      {/* ── KPI Cards ──────────────────────────────────────────────────── */}
      <motion.div variants={itemVariants} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SharpKPICard
          label="Total Monthly Payroll"
          value={`PKR ${Math.round(parseFloat(data.totalSalaryBudget)).toLocaleString()}`}
          subtext="Basic + monthly allowances (active)"
          icon={DollarSign}
          theme="blue"
        />
        <SharpKPICard
          label="Net Paid & Generated"
          value={`PKR ${Math.round(parseFloat(data.totalNetProcessed)).toLocaleString()}`}
          subtext={`${data.payslipsGeneratedCount} slip${data.payslipsGeneratedCount !== 1 ? "s" : ""} finalized`}
          icon={CheckCircle2}
          theme="emerald"
        />
        <SharpKPICard
          label="Pending Salaries"
          value={`PKR ${Math.round(parseFloat(data.totalPendingGross)).toLocaleString()}`}
          subtext={`${data.activeCount - data.payslipsGeneratedCount} remaining · incl. allowances`}
          icon={Clock}
          theme="amber"
        />
        <SharpKPICard
          label="Staff Progress"
          value={`${completionPct}%`}
          subtext={`${data.payslipsGeneratedCount} of ${data.activeCount} staff done`}
          icon={Users}
          theme="violet"
          progress={completionPct}
        />
      </motion.div>

      {missedCyclesData?.missed && missedCyclesData.missed.length > 0 && (
        <motion.div variants={itemVariants}>
          <Alert className="rounded-none border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40">
            <AlertCircle className="size-4 text-amber-600 shrink-0" />
            <div className="flex-1">
              <AlertTitle className="text-amber-800 dark:text-amber-400 font-semibold text-sm">
                Missed Salary Cycles Detected
              </AlertTitle>
              <AlertDescription className="text-amber-700 dark:text-amber-500 text-xs leading-relaxed">
                We found {missedCyclesData.missed.length} instances of employees missing historical salary payments.
                Search for them below to roll forward their missed salary into the current cycle.
              </AlertDescription>
            </div>
          </Alert>
        </motion.div>
      )}

      {/* ── Table ──────────────────────────────────────────────────────── */}
      <motion.div variants={itemVariants} className="rounded-none border border-border bg-card shadow-none">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-6 py-5 border-b border-border bg-transparent">
          <div>
            <p className="font-bold uppercase text-foreground">Payroll Register</p>
            <p className="text-[10px] font-semibold text-muted-foreground mt-1">
              Process salaries and review payslip status.
            </p>
          </div>
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative w-full sm:w-[260px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search employee or code..."
                value={globalFilter ?? ""}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="pl-9 h-9 bg-transparent border-border rounded-none"
              />
            </div>
            <div className="p-2 border border-border bg-muted/10">
              <TrendingUp className="size-4 text-muted-foreground" />
            </div>
          </div>
        </div>

        <div className="p-0 sm:p-4 overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/40">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent border-b">
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className="text-xs font-semibold text-muted-foreground py-3 h-11 first:pl-4 last:pr-4"
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className="hover:bg-muted/30 transition-colors border-b last:border-0">
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="py-3 text-sm first:pl-4 last:pr-4">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={7} className="h-64">
                    <GenericEmpty
                      icon={HREmptyIllustration}
                      title="No results found"
                      description="Try adjusting your search or filters."
                    />
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-border bg-transparent">
          <p className="text-xs text-muted-foreground">
            Page {pageIndex + 1} of {Math.max(1, totalPages)}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPageIndex((p) => Math.max(0, p - 1))}
              disabled={pageIndex === 0}
              className="h-8 px-3 rounded-none text-xs font-medium"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPageIndex((p) => p + 1)}
              disabled={pageIndex >= totalPages - 1}
              className="h-8 px-3 rounded-none text-xs font-medium"
            >
              Next
            </Button>
          </div>
        </div>
      </motion.div>

      <SalaryCalculatorSheet
        isOpen={isCalculatorOpen}
        onClose={() => { setIsCalculatorOpen(false); setSelectedEmployeeId(null); }}
        employeeId={selectedEmployeeId}
        month={month}
      />
    </motion.div>
  );
}

// ── Sharp Pixel-Perfect KPI Component ───────────────────────────────────────

type KPITheme = "blue" | "emerald" | "amber" | "violet";

const sharpThemeStyles = {
  blue: { border: "border-t-blue-500", iconBg: "bg-blue-500/10", iconText: "text-blue-500", bar: "bg-blue-500" },
  emerald: { border: "border-t-emerald-500", iconBg: "bg-emerald-500/10", iconText: "text-emerald-500", bar: "bg-emerald-500" },
  amber: { border: "border-t-amber-500", iconBg: "bg-amber-500/10", iconText: "text-amber-500", bar: "bg-amber-500" },
  violet: { border: "border-t-violet-500", iconBg: "bg-violet-500/10", iconText: "text-violet-500", bar: "bg-violet-500" },
};

function SharpKPICard({
  label,
  value,
  subtext,
  icon: Icon,
  theme,
  progress,
}: {
  label: string;
  value: React.ReactNode;
  subtext: string;
  icon: React.ComponentType<{ className?: string }>;
  theme: KPITheme;
  progress?: number;
}) {
  const styles = sharpThemeStyles[theme];

  return (
    <motion.div
      whileHover={{ y: -2, transition: { duration: 0.2 } }}
      className={cn(
        "relative flex flex-col justify-between p-5 bg-card border border-border rounded-none shadow-none border-t-2",
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
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
        <div className={cn("p-1.5 rounded-none", styles.iconBg)}>
          <Icon className={cn("size-4", styles.iconText)} />
        </div>
      </div>

      <div className="relative z-10 space-y-1">
        <div className="text-3xl font-bold tracking-tight text-foreground">{value}</div>
        <p className="text-xs font-medium text-muted-foreground/70">{subtext}</p>
        {progress !== undefined && (
          <div className="mt-3 h-1.5 bg-black/10 dark:bg-white/10 rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", styles.bar)}
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
        )}
      </div>
    </motion.div>
  );
}

function PendingApprovalsWarning() {
  const { data: counts } = useQuery({
    queryKey: ["pending-approval-counts"],
    queryFn: () => getPendingApprovalCountsFn(),
    staleTime: 30_000,
  });

  if (!counts || counts.total === 0) return null;

  const parts: string[] = [];
  if (counts.leave > 0) parts.push(`${counts.leave} leave request${counts.leave !== 1 ? "s" : ""}`);
  if (counts.overtime > 0) parts.push(`${counts.overtime} overtime request${counts.overtime !== 1 ? "s" : ""}`);
  if (counts.advances > 0) parts.push(`${counts.advances} salary advance${counts.advances !== 1 ? "s" : ""}`);

  return (
    <div className="flex items-center gap-3 px-4 py-3 rounded-none border border-orange-200 bg-orange-50 dark:bg-orange-950/20 dark:border-orange-800/30 animate-in fade-in duration-300">
      <div className="p-1.5 rounded-none bg-orange-100 dark:bg-orange-900/40">
        <AlertTriangle className="size-4 text-orange-600 dark:text-orange-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-orange-800 dark:text-orange-300">Pending Approvals Detected</p>
        <p className="text-xs text-orange-600 dark:text-orange-400 mt-0.5">
          {parts.join(", ")} awaiting admin decision. Resolve these before generating payslips to ensure accurate deductions and Bradford Factor calculations.
        </p>
      </div>
      <Link to="/hr/approvals">
        <Button size="sm" variant="outline" className="h-7 text-xs font-semibold border-orange-300 text-orange-700 hover:bg-orange-100 dark:border-orange-700 dark:text-orange-400 dark:hover:bg-orange-900/40 shrink-0 rounded-none">
          Review Approvals
        </Button>
      </Link>
    </div>
  );
}

// ── Payroll Cycle Banner ───────────────────────────────────────────────────
function PayrollCycleBanner({ cycle, inGrace }: { cycle: any; inGrace: boolean }) {
  const percent = cycleProgressPercent(cycle);
  const remaining = daysRemainingInCycle(cycle);

  const startObj = new Date(cycle.cycleStart);
  const endObj = new Date(cycle.cycleEnd);

  const formattedDates = {
    start: startObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
    end: endObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
  };

  return (
    <div className={cn(
      "relative overflow-hidden rounded-none border border-l-2 bg-card shadow-none",
      inGrace
        ? "border-l-amber-500 border-amber-200 dark:border-amber-900/40"
        : "border-l-indigo-500 border-indigo-200 dark:border-indigo-900/40"
    )}>
      <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between p-5">
        <div className="space-y-2 flex-1">
          <Badge
            variant="outline"
            className={cn(
              "text-xs font-semibold uppercase tracking-wide rounded-none",
              inGrace
                ? "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/40 dark:text-amber-300 dark:border-amber-700"
                : "bg-indigo-100 text-indigo-800 border-indigo-300 dark:bg-indigo-900/40 dark:text-indigo-300 dark:border-indigo-700"
            )}
          >
            {inGrace ? (
              <span className="flex items-center gap-1.5">
                <Timer className="size-3" /> Grace Period Active
              </span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Calendar className="size-3" /> Active Payroll Cycle
              </span>
            )}
          </Badge>
          <h2 className="text-xl font-semibold tracking-tight flex items-center gap-2">
            <Banknote className={cn("size-5", inGrace ? "text-amber-500" : "text-indigo-500")} />
            {formattedDates.start} — {formattedDates.end}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-[600px]">
            {inGrace
              ? "The cycle is closed. Generating and processing payslips is now enabled until payouts occur on the 25th."
              : "Staff attendance, leaves, and overtime are actively accruing for this period. Slips cannot be generated yet."}
          </p>
        </div>

        {!inGrace && (
          <div className="w-full md:w-[260px] bg-card p-4 rounded-none border border-border">
            <div className="flex justify-between items-end mb-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground">Cycle Progress</p>
                <p className="text-2xl font-semibold leading-none text-indigo-600 dark:text-indigo-400">
                  {Math.round(percent)}%
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium text-muted-foreground">Time Left</p>
                <p className="text-sm font-semibold">{remaining} day{remaining !== 1 ? "s" : ""}</p>
              </div>
            </div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-1000"
                style={{ width: `${percent}%` }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
