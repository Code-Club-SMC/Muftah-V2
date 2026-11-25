import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { countDays, MAX_BULK_DAYS } from "@/lib/attendance/bulk-mark";
import { isFieldStaff } from "@/lib/attendance/device-import/field-staff";
import { getEmployeesFn } from "@/server-functions/hr/employees/get-employees-fn";
import {
  useBulkMarkAttendance,
  useBulkAttendancePreview,
  useUndoBulkPresent,
  useUndoBulkPresentPreview,
} from "@/hooks/hr/use-bulk-mark-attendance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2,
  CalendarRange,
  Users,
  Clock,
  CheckCircle2,
  AlertCircle,
  Info,
  MoonStar,
  RefreshCcw,
  Search,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DatePicker } from "@/components/custom/date-picker";

// ── Types ──────────────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-select a specific date range (e.g. from an "unmarked days" alert) */
  initialStartDate?: string;
  initialEndDate?: string;
}

// ── Status config ──────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  {
    value: "present",
    label: "Present",
    color: "text-emerald-600 dark:text-emerald-500",
    activeBg: "bg-background  border border-border/40 text-emerald-600",
  },
  {
    value: "absent",
    label: "Absent",
    color: "text-rose-600 dark:text-rose-500",
    activeBg: "bg-background  border border-border/40 text-rose-600",
  },
  {
    value: "leave",
    label: "On Leave",
    color: "text-amber-600 dark:text-amber-500",
    activeBg: "bg-background  border border-border/40 text-amber-600",
  },
  {
    value: "holiday",
    label: "Holiday",
    color: "text-blue-600 dark:text-blue-500",
    activeBg: "bg-background  border border-border/40 text-blue-600",
  },
] as const;

// ── Component ──────────────────────────────────────────────────────────────

export const BulkAttendanceSheet = ({
  open,
  onOpenChange,
  initialStartDate,
  initialEndDate,
}: Props) => {
  // Every active employee, not only those who had joined by the day on screen.
  const employeesQuery = useQuery({
    queryKey: ["employees", "active"],
    queryFn: () => getEmployeesFn({ data: { status: "active" } }),
    enabled: open,
  });
  const activeEmployees = [...(employeesQuery.data ?? [])].sort((a, b) =>
    `${a.firstName} ${a.lastName}`.localeCompare(
      `${b.firstName} ${b.lastName}`,
    ),
  );

  // ── Local state ───────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(true);
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState<Date | undefined>(
    initialStartDate ? parseISO(initialStartDate) : undefined,
  );
  const [endDate, setEndDate] = useState<Date | undefined>(
    initialEndDate ? parseISO(initialEndDate) : undefined,
  );
  const [status, setStatus] = useState<
    "present" | "absent" | "leave" | "holiday"
  >("present");
  const [leaveType, setLeaveType] = useState<
    "sick" | "annual" | "special" | null
  >(null);
  const [undoing, setUndoing] = useState(false);
  const [conflictStrategy, setConflictStrategy] = useState<
    "skip" | "overwrite"
  >("skip");
  const [notes, setNotes] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const markMutation = useBulkMarkAttendance();
  const undoMutation = useUndoBulkPresent();
  const isSaving = markMutation.isPending || undoMutation.isPending;

  // ── Derived ───────────────────────────────────────────────────────────────
  const filteredEmployees = activeEmployees.filter((e) => {
    const q = search.toLowerCase();
    return (
      `${e.firstName} ${e.lastName}`.toLowerCase().includes(q) ||
      e.employeeCode.toLowerCase().includes(q) ||
      e.designation.toLowerCase().includes(q)
    );
  });

  const effectiveEmployeeIds = selectAll
    ? activeEmployees.map((e) => e.id)
    : [...selectedIds];

  const start = startDate ? format(startDate, "yyyy-MM-dd") : "";
  const end = endDate ? format(endDate, "yyyy-MM-dd") : "";
  const rangeError =
    !start || !end
      ? null
      : end < start
        ? "End date must be on or after the start date"
        : countDays(start, end) > MAX_BULK_DAYS
          ? `Choose at most ${MAX_BULK_DAYS} days at a time`
          : null;

  const range =
    open && start && end && !rangeError && effectiveEmployeeIds.length > 0
      ? {
          employeeIds: selectAll ? [] : effectiveEmployeeIds,
          startDate: start,
          endDate: end,
        }
      : null;
  const previewInput =
    range && !undoing && (status !== "leave" || leaveType)
      ? {
          ...range,
          template: {
            status,
            leaveType: status === "leave" ? leaveType : null,
          },
          conflictStrategy,
        }
      : null;

  const undoInput = undoing ? range : null;

  // The note does not change the counts, so typing it does not reload the preview.
  const markPreview = useBulkAttendancePreview(previewInput, !!previewInput);
  const undoPreviewQuery = useUndoBulkPresentPreview(undoInput);
  const active = undoing ? undoPreviewQuery : markPreview;
  const previewLoading = active.isFetching;
  const previewError = active.error;
  const blockedReason = active.data?.blockedReason ?? null;
  const preview = undoing ? undefined : markPreview.data;
  const undoPreview = undoing ? undoPreviewQuery.data : undefined;
  const changeCount = undoing
    ? (undoPreview?.willClear ?? 0)
    : (preview?.willCreate ?? 0) + (preview?.willUpdate ?? 0);
  const noteMissing = !!preview?.noteNeeded && !notes.trim();

  // ── Handlers ──────────────────────────────────────────────────────────────
  const toggleEmployee = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
    setSelectAll(false);
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) setSelectedIds(new Set());
  };

  const handleApply = () => {
    if (canApply) setConfirmOpen(true);
  };

  const handleConfirm = async () => {
    try {
      if (undoInput) await undoMutation.mutateAsync(undoInput);
      else if (previewInput)
        await markMutation.mutateAsync({
          ...previewInput,
          template: { ...previewInput.template, notes: notes.trim() || null },
        });
      else return;
    } catch {
      // The reason is already on screen. Keep the choices so HR can correct them.
      setConfirmOpen(false);
      return;
    }
    setConfirmOpen(false);
    onOpenChange(false);
  };

  const canApply =
    !!(undoInput ?? previewInput) &&
    !previewLoading &&
    !previewError &&
    !blockedReason &&
    !noteMissing &&
    changeCount > 0;

  // ── Reset on open ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setSelectAll(true);
      setSelectedIds(new Set());
      setSearch("");
      setStatus("present");
      setUndoing(false);
      setLeaveType(null);
      setConflictStrategy("skip");
      setNotes("");
      setConfirmOpen(false);
      setStartDate(initialStartDate ? parseISO(initialStartDate) : undefined);
      setEndDate(initialEndDate ? parseISO(initialEndDate) : undefined);
    }
  }, [open, initialStartDate, initialEndDate]);

  return (
    <>
      <ResponsiveSheet
        open={open}
        onOpenChange={(next) => !isSaving && onOpenChange(next)}
        title="Bulk Mark Attendance"
        description="Mark multiple employees across a date range in one action."
        icon={CalendarRange}
        className="sm:max-w-2xl"
      >
        <div className="py-5 space-y-6">
          {/* ── Section 1: Date Range ─────────────────────────────── */}
          <div className="space-y-3">
            <SectionLabel icon={CalendarRange} label="Date Range" />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase  text-muted-foreground">
                  From
                </p>
                <DatePicker
                  date={startDate}
                  onChange={setStartDate}
                  placeholder="Start date"
                  className="w-full h-9 text-[13px]"
                />
              </div>
              <div className="space-y-1">
                <p className="text-[11px] font-bold uppercase  text-muted-foreground">
                  To
                </p>
                <DatePicker
                  date={endDate}
                  onChange={setEndDate}
                  placeholder="End date"
                  className="w-full h-9 text-[13px]"
                />
              </div>
            </div>
            {rangeError && (
              <p className="text-[11px] text-destructive flex items-center gap-1">
                <AlertCircle className="size-3" /> {rangeError}
              </p>
            )}
          </div>

          <Separator className="opacity-40" />

          {/* ── Section 2: Attendance Template ───────────────────── */}
          <div className="space-y-4">
            <SectionLabel icon={Clock} label="Attendance Template" />

            {/* Status selector */}
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-1 p-1 rounded-lg bg-muted/40 border border-border/50">
              {STATUS_OPTIONS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  aria-pressed={!undoing && status === s.value}
                  onClick={() => {
                    setUndoing(false);
                    setStatus(s.value);
                  }}
                  className={cn(
                    "rounded-md py-1.5 text-[12px] font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    !undoing && status === s.value
                      ? s.activeBg
                      : "text-muted-foreground hover:text-foreground border border-transparent",
                  )}
                >
                  {s.label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={undoing}
                onClick={() => setUndoing(true)}
                className={cn(
                  "rounded-md py-1.5 text-[12px] font-semibold transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  undoing
                    ? "bg-background border border-border/40 text-foreground"
                    : "text-muted-foreground hover:text-foreground border border-transparent",
                )}
              >
                Undo Present
              </button>
            </div>

            {undoing && (
              <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                <p className="text-[12px] font-semibold text-foreground">
                  Undo a bulk Present
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Removes only punches added by Bulk Mark, and leaves those days
                  unmarked. Device and QR punches are never removed. Days
                  changed since are kept. For order bookers, salesmen and
                  drivers, mark the correct status with Overwrite All instead.
                </p>
              </div>
            )}

            {/* Leave type — only for leave status */}
            {!undoing && status === "leave" && (
              <div className="space-y-1.5 animate-in fade-in duration-200">
                <p className="text-[12px] font-medium text-foreground/80">
                  Leave Type <span className="text-destructive">*</span>
                </p>
                <Select
                  value={leaveType || ""}
                  onValueChange={(v) => setLeaveType(v as any)}
                >
                  <SelectTrigger className="h-9 text-[13px] bg-background border-border/60">
                    <SelectValue placeholder="Select leave type…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="annual">Annual Leave</SelectItem>
                    <SelectItem value="sick">Sick Leave</SelectItem>
                    <SelectItem value="special">Special Leave</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-start gap-2 p-2.5 rounded-lg border border-amber-200/60 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20">
                  <Info className="size-3.5 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-700/80 dark:text-amber-500/80 leading-relaxed">
                    All bulk-marked leaves are set to <strong>Pending</strong>{" "}
                    and require individual admin approval.
                  </p>
                </div>
              </div>
            )}

            {!undoing && status === "present" && (
              <div className="space-y-3 animate-in fade-in duration-200">
                <div className="rounded-lg border border-emerald-200/60 bg-emerald-50/50 p-3 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                  <p className="text-[12px] font-semibold text-emerald-700 dark:text-emerald-400">
                    Present is punch-driven
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-emerald-700/80 dark:text-emerald-400/80">
                    Bulk present creates one `IN` punch at the start and one
                    `OUT` punch at the end of every shift of the day. Order
                    bookers, salesmen and drivers are marked present without
                    punches.
                  </p>
                </div>
                <div className="rounded-lg border border-border/60 bg-background/70 p-3">
                  <p className="text-[11px] font-semibold text-foreground">
                    Safety rules
                  </p>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Office staff without complete shift times are skipped. So
                    are shifts that have not finished yet. Days that already
                    have punches, trips or deliveries are never replaced.
                  </p>
                </div>
              </div>
            )}

            {/* Notes */}
            {!undoing && (
              <div className="space-y-1.5">
                <p className="text-[12px] font-medium text-foreground/80">
                  Notes{" "}
                  {preview?.noteNeeded ? (
                    <span className="text-destructive">*</span>
                  ) : (
                    <span className="text-muted-foreground font-normal">
                      (optional)
                    </span>
                  )}
                </p>
                <Input
                  placeholder="e.g. Public holiday, Office closed"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  aria-label="Notes"
                  maxLength={500}
                  className="h-9 text-[13px] bg-background border-border/60"
                />
                {noteMissing && (
                  <p className="text-[11px] text-destructive flex items-center gap-1">
                    <AlertCircle className="size-3" /> A note is required for
                    order bookers, salesmen and drivers.
                  </p>
                )}
              </div>
            )}
          </div>

          <Separator className="opacity-40" />

          {/* ── Section 3: Conflict Strategy ─────────────────────── */}
          {!undoing && (
            <>
              <div className="space-y-3">
                <SectionLabel icon={RefreshCcw} label="Existing Records" />
                <div className="flex p-1 rounded-lg bg-muted/40 border border-border/50">
                  {(["skip", "overwrite"] as const).map((strategy) => (
                    <button
                      key={strategy}
                      type="button"
                      onClick={() => setConflictStrategy(strategy)}
                      className={cn(
                        "flex-1 rounded-md py-1.5 text-[12px] font-semibold transition-all duration-150 focus:outline-none",
                        conflictStrategy === strategy
                          ? "bg-background text-foreground  border border-border/40"
                          : "text-muted-foreground hover:text-foreground border border-transparent",
                      )}
                    >
                      {strategy === "skip" ? "Keep Existing" : "Overwrite All"}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {conflictStrategy === "skip"
                    ? "Days that already have an attendance record will not be touched."
                    : "Records marked by hand will be replaced. Days with punches, trips or deliveries are always kept."}
                </p>
              </div>

              <Separator className="opacity-40" />
            </>
          )}

          {/* ── Section 4: Employee Selection ────────────────────── */}
          <div className="space-y-3">
            <SectionLabel icon={Users} label="Employees" />

            {/* Select all toggle */}
            <label
              className={cn(
                "flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all",
                selectAll
                  ? "bg-primary/5 border-primary/30"
                  : "bg-background border-border/60 hover:bg-muted/30",
              )}
            >
              <Checkbox
                checked={selectAll}
                onCheckedChange={handleSelectAll}
                className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
              />
              <div>
                <p
                  className={cn(
                    "text-[13px] font-semibold",
                    selectAll ? "text-primary" : "text-foreground",
                  )}
                >
                  All Active Employees
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {employeesQuery.isError
                    ? "Could not load the employee list"
                    : employeesQuery.isPending
                      ? "Loading…"
                      : `${activeEmployees.length} employee${activeEmployees.length !== 1 ? "s" : ""}`}
                </p>
              </div>
            </label>

            {/* Individual employee picker */}
            {!selectAll && (
              <div className="space-y-2 animate-in fade-in duration-200">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
                  <Input
                    placeholder="Search employees…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-8 h-8 text-[12px] bg-background border-border/60"
                  />
                </div>

                <div className="border border-border/50 rounded-lg overflow-hidden max-h-[200px] overflow-y-auto">
                  {filteredEmployees.map((emp) => {
                    const checked = selectedIds.has(emp.id);
                    return (
                      <label
                        key={emp.id}
                        className={cn(
                          "flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors border-b border-border/30 last:border-0",
                          checked ? "bg-primary/5" : "hover:bg-muted/30",
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggleEmployee(emp.id)}
                        />
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <div className="size-6 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                            <span className="text-[9px] font-bold text-primary">
                              {emp.firstName[0]}
                              {emp.lastName[0]}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-[12px] font-semibold truncate">
                              {emp.firstName} {emp.lastName}
                            </p>
                            <p className="text-[10px] text-muted-foreground">
                              {emp.designation}
                              {isFieldStaff(emp) && " · Field staff"}
                            </p>
                          </div>
                        </div>
                        {(emp.restDays ?? [0]).length > 0 && (
                          <div className="flex items-center gap-0.5 shrink-0">
                            <MoonStar className="size-3 text-slate-400" />
                            <span className="text-[9px] text-slate-400">
                              {(emp.restDays ?? [0])
                                .map(
                                  (d) =>
                                    ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][
                                      d
                                    ],
                                )
                                .join(",")}
                            </span>
                          </div>
                        )}
                      </label>
                    );
                  })}
                  {employeesQuery.isSuccess &&
                    filteredEmployees.length === 0 && (
                      <p className="text-[12px] text-muted-foreground text-center py-6">
                        No employees match "{search}"
                      </p>
                    )}
                </div>

                {selectedIds.size > 0 && (
                  <p className="text-[11px] text-primary font-semibold">
                    {selectedIds.size} employee
                    {selectedIds.size !== 1 ? "s" : ""} selected
                  </p>
                )}
              </div>
            )}
          </div>

          {/* ── Preview Summary ───────────────────────────────────── */}
          {(undoInput ?? previewInput) && (
            <div
              className={cn(
                "rounded-xl border p-4 space-y-3",
                changeCount > 0
                  ? "bg-emerald-50/50 border-emerald-200/60 dark:bg-emerald-950/20 dark:border-emerald-900/40"
                  : "bg-muted/30 border-border/50",
              )}
            >
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-black uppercase  text-muted-foreground">
                  Preview
                </p>
                {previewLoading && (
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                )}
              </div>

              {undoPreview && !previewLoading && (
                <div className="grid grid-cols-2 gap-2">
                  <PreviewStat
                    label="Days To Unmark"
                    value={undoPreview.willClear}
                    color="blue"
                  />
                  <PreviewStat
                    label="Changed Since, Kept"
                    value={undoPreview.keptEdited}
                    color="slate"
                  />
                </div>
              )}

              {preview && !previewLoading ? (
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                  <PreviewStat
                    label="Will Create"
                    value={preview.willCreate}
                    color="emerald"
                  />
                  <PreviewStat
                    label="Will Update"
                    value={preview.willUpdate}
                    color="blue"
                  />
                  <PreviewStat
                    label="Rest Days Skipped"
                    value={preview.skippedRestDays}
                    color="slate"
                    icon={<MoonStar className="size-3" />}
                  />
                  <PreviewStat
                    label="Existing Skipped"
                    value={preview.skippedExisting}
                    color="slate"
                  />
                  <PreviewStat
                    label="Worked Days Kept"
                    value={preview.skippedPunchDays}
                    color="slate"
                  />
                  <PreviewStat
                    label="No Usable Shift"
                    value={preview.skippedMissingShift}
                    color="slate"
                  />
                  {preview.skippedFuture > 0 && (
                    <PreviewStat
                      label="Not Finished Yet"
                      value={preview.skippedFuture}
                      color="slate"
                    />
                  )}
                  {preview.skippedNotJoined > 0 && (
                    <PreviewStat
                      label="Before Joining"
                      value={preview.skippedNotJoined}
                      color="slate"
                    />
                  )}
                  {preview.skippedHolidays > 0 && (
                    <PreviewStat
                      label="Holidays Skipped"
                      value={preview.skippedHolidays}
                      color="slate"
                    />
                  )}
                </div>
              ) : null}

              {!previewLoading && (previewError || blockedReason) && (
                <p className="flex items-start gap-2 text-[12px] text-destructive">
                  <AlertCircle className="size-3.5 shrink-0 mt-0.5" />
                  {blockedReason ??
                    "The preview could not be loaded. Change a choice or try again."}
                </p>
              )}

              {active.data && changeCount === 0 && !previewLoading && (
                <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                  <Info className="size-3.5 shrink-0" />
                  Nothing to apply.
                  {conflictStrategy === "skip" &&
                    !!preview?.skippedExisting && (
                      <>
                        {" "}
                        Switch to "Overwrite All" to replace days marked by
                        hand.
                      </>
                    )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Footer ───────────────────────────────────────────────────── */}
        <div className="border-t pt-4 mt-2">
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button
              className="flex-1"
              onClick={handleApply}
              disabled={!canApply || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="size-4 mr-2 animate-spin" /> Applying…
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-4 mr-2" />{" "}
                  {undoing ? "Undo Present" : "Apply Bulk Mark"}
                </>
              )}
            </Button>
          </div>
        </div>
      </ResponsiveSheet>

      {/* ── Confirmation Dialog ───────────────────────────────────────────── */}
      <AlertDialog
        open={confirmOpen}
        onOpenChange={(next) => !isSaving && setConfirmOpen(next)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {undoing ? "Undo bulk Present" : "Confirm Bulk Mark"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  {undoPreview
                    ? `${undoPreview.willClear} ${undoPreview.willClear === 1 ? "day" : "days"} for ${undoPreview.affectedEmployees} ${undoPreview.affectedEmployees === 1 ? "person" : "people"} will become unmarked and must be marked again before payroll.`
                    : "This will apply the following changes:"}
                </p>
                {preview && (
                  <div className="bg-muted/40 rounded-lg p-3 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Status</span>
                      <Badge variant="outline" className="capitalize text-xs">
                        {status}
                      </Badge>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Records to create
                      </span>
                      <span className="font-bold text-emerald-600">
                        {preview.willCreate}
                      </span>
                    </div>
                    {preview.willUpdate > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Records to overwrite
                        </span>
                        <span className="font-bold text-blue-600">
                          {preview.willUpdate}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">
                        Employees affected
                      </span>
                      <span className="font-bold">
                        {preview.affectedEmployees} of {preview.totalEmployees}
                      </span>
                    </div>
                    {preview.skippedPunchDays > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Worked days kept
                        </span>
                        <span className="font-bold text-slate-600 dark:text-slate-400">
                          {preview.skippedPunchDays}
                        </span>
                      </div>
                    )}
                    {preview.skippedMissingShift > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">
                          Missing shift days skipped
                        </span>
                        <span className="font-bold text-slate-600 dark:text-slate-400">
                          {preview.skippedMissingShift}
                        </span>
                      </div>
                    )}
                  </div>
                )}
                {conflictStrategy === "overwrite" &&
                  preview &&
                  preview.willUpdate > 0 && (
                    <p className="text-destructive text-xs flex items-center gap-1.5">
                      <AlertCircle className="size-3.5 shrink-0" />
                      {preview.willUpdate} existing hand-marked records will be
                      replaced.
                    </p>
                  )}
                <p className="text-xs text-muted-foreground">
                  {undoing
                    ? "The removed punches are kept in the correction history. "
                    : status === "present"
                      ? "Undo Present can remove these punches later, but cannot bring back a record you overwrite. "
                      : "This cannot be undone in one step. "}
                  Draft payslips for these days must be regenerated before
                  approval.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSaving}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleConfirm();
              }}
              disabled={!canApply || isSaving}
            >
              {isSaving ? (
                <>
                  <Loader2 className="size-4 mr-1.5 animate-spin" />
                  Applying…
                </>
              ) : (
                "Confirm & Apply"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ icon: Icon, label }: { icon: any; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-muted-foreground" />
      <h3 className="text-[12px] font-black uppercase  text-foreground">
        {label}
      </h3>
    </div>
  );
}

function PreviewStat({
  label,
  value,
  color,
  icon,
}: {
  label: string;
  value: number;
  color: "emerald" | "blue" | "slate";
  icon?: React.ReactNode;
}) {
  const colorMap = {
    emerald: "text-emerald-700 dark:text-emerald-400",
    blue: "text-blue-700 dark:text-blue-400",
    slate: "text-slate-500 dark:text-slate-400",
  };
  return (
    <div className="flex items-center justify-between p-2.5 rounded-lg bg-background/60 border border-border/40">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[11px] text-muted-foreground">{label}</span>
      </div>
      <span className={cn("text-sm font-black tabular-nums", colorMap[color])}>
        {value}
      </span>
    </div>
  );
}
