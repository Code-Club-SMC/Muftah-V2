import { useForm, useStore } from "@tanstack/react-form";
import { Loader2, Plus, Trash2, AlertCircle, Calculator, Info, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { usePreviewPayslip } from "@/hooks/hr/use-preview-payslip";
import { useSavePayslip } from "@/hooks/hr/use-save-payslip";
import { format, parseISO } from "date-fns";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import React, { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { STANDARD_ALLOWANCES, type AttendanceDeductionAdjustments } from "@/lib/types/hr-types";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { ShieldAlert } from "lucide-react";
import { getCycleForPayoutMonth } from "@/lib/payroll-cycle";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

// ── Allowance display name resolver ──────────────────────────────────────────
const ALLOWANCE_LABELS: Record<string, string> = Object.fromEntries(
    STANDARD_ALLOWANCES.map((a) => [a.id, a.name]),
);

function getAllowanceLabel(id: string): string {
    if (id === "basicSalary") return "Basic Salary";
    return (
        ALLOWANCE_LABELS[id] ??
        id.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase())
    );
}

function BreakdownExplanationDialog({ title, log, typeKeys }: { title: string, log: any[], typeKeys: string[] }) {
    const [open, setOpen] = useState(false);
    const filteredLog = log?.filter(l => typeKeys.includes(l.type)) || [];
    
    if (filteredLog.length === 0) return null;

    return (
        <>
            <Button 
                variant="ghost" 
                size="icon" 
                className="h-5 w-5 ml-1.5 hover:bg-transparent text-muted-foreground hover:text-foreground"
                onClick={() => setOpen(true)}
            >
                <Info className="size-3.5" />
            </Button>
            
            <ResponsiveDialog
                title={`${title} Breakdown`}
                description="Review the specific attendance logs contributing to this amount."
                open={open}
                onOpenChange={setOpen}
                className="max-w-md p-0"
                noScroll
            >
                <ScrollArea className="max-h-[60vh]">
                    <div className="space-y-0 p-4 pt-0">
                        {filteredLog.map((entry, idx) => (
                            <div key={idx} className="flex justify-between items-start py-3 border-b last:border-0 text-sm">
                                <div>
                                    <div className="font-semibold text-foreground">{format(parseISO(entry.date), "EEE, dd MMM yyyy")}</div>
                                    <div className="text-muted-foreground text-xs mt-0.5">{entry.description}</div>
                                </div>
                                <div className="font-mono text-xs bg-muted px-2 py-1 rounded whitespace-nowrap ml-2">
                                    {entry.value} {entry.unit}
                                </div>
                            </div>
                        ))}
                    </div>
                </ScrollArea>
            </ResponsiveDialog>
        </>
    );
}

type SalaryCalculatorFormProps = {
    employeeId: string;
    month: string;
    onSuccess: () => void;
    isOpen: boolean;
};

export const SalaryCalculatorForm = ({ employeeId, month, onSuccess, isOpen }: SalaryCalculatorFormProps) => {
    const [activeTab, setActiveTab] = useState("overview");
    const [selectedArrearsKeys, setSelectedArrearsKeys] = useState<Set<string>>(new Set());
    const [earlyCutoffDate, setEarlyCutoffDate] = useState<string | undefined>();
    const [ignorePastUnmarkedDays, setIgnorePastUnmarkedDays] = useState(false);
    const [showUnmarkedModal, setShowUnmarkedModal] = useState<{ count: number } | null>(null);

    const [attendanceAdjustments, setAttendanceAdjustments] = useState<AttendanceDeductionAdjustments>({});

    const saveMutation = useSavePayslip(onSuccess);

    const [cyYear, cyMonth] = month.split("-").map(Number);
    const cycle = getCycleForPayoutMonth(cyYear, cyMonth);
    const today = format(new Date(), "yyyy-MM-dd");
    const isEarlyProcessing = cycle && today < cycle.cycleEnd;

    const form = useForm({
        defaultValues: {
            bonus: "",
            incentive: "",
            tax: "",
            advance: "",
            overtimeMultiplier: "1.0",
            manualDeductions: [] as { description: string; amount: string }[],
            remarks: "",
        },
        onSubmit: async () => { },
    });

    const formValues = useStore(form.store, (state: any) => state.values);

    const { data: calculation, isFetching, isLoading, isError, error } = usePreviewPayslip({
        employeeId,
        month,
        manualDeductions: formValues.manualDeductions.map((d: any) => ({
            description: d.description,
            amount: parseFloat(d.amount) || 0,
        })),
        additionalAmounts: {
            bonusAmount: parseFloat(formValues.bonus) || 0,
            incentiveAmount: parseFloat(formValues.incentive) || 0,
            taxDeduction: parseFloat(formValues.tax) || 0,
            advanceDeduction: formValues.advance === "" ? undefined : (parseFloat(formValues.advance) || 0),
            overtimeMultiplier: parseFloat(formValues.overtimeMultiplier) || 1.0,
        },
        arrears: selectedArrearsKeys.size > 0 ? {
            arrearsFromMonths: Array.from(selectedArrearsKeys),
            arrearsAmount: Array.from(selectedArrearsKeys).reduce((sum, key) => {
                const missed = calculation?.missedCycles?.find(m => m.monthKey === key);
                return sum + (missed?.amount || 0);
            }, 0),
        } : undefined,
        earlyCutoffDate,
        attendanceAdjustments,
    }, isOpen);

    const initialAdjustmentsLoadedRef = useRef<string | null>(null);
    useEffect(() => {
        initialAdjustmentsLoadedRef.current = null;
    }, [employeeId, month]);

    useEffect(() => {
        const key = `${employeeId}-${month}`;
        if (calculation && initialAdjustmentsLoadedRef.current !== key) {
            if (calculation.attendanceAdjustments && Object.keys(calculation.attendanceAdjustments).length > 0) {
                setAttendanceAdjustments(calculation.attendanceAdjustments);
            }
            initialAdjustmentsLoadedRef.current = key;
        }
    }, [calculation, employeeId, month]);

    // Pre-fill remarks with the standard OTL-exceptions note once the preview
    // loads, but only if the user hasn't already typed something. Reset when
    // the target month changes so a reopened sheet picks up the new period.
    const defaultRemarksSetRef = useRef(false);
    useEffect(() => {
        defaultRemarksSetRef.current = false;
    }, [month]);
    useEffect(() => {
        if (
            !defaultRemarksSetRef.current &&
            calculation &&
            (!formValues.remarks || formValues.remarks === "")
        ) {
            const monthName = format(parseISO(`${month}-01`), "MMM");
            const start = format(parseISO(calculation.startDate), "dd/MM/yyyy");
            const end = format(parseISO(calculation.endDate), "dd/MM/yyyy");
            const defaultRemarks = `${monthName} Salary includes OTL exceptions from ${start} to ${end}`;
            form.setFieldValue("remarks", defaultRemarks);
            defaultRemarksSetRef.current = true;
        }
    }, [calculation, form, formValues.remarks, month]);

    const handleToggleArrears = (monthKey: string) => {
        setSelectedArrearsKeys(prev => {
            const next = new Set(prev);
            if (next.has(monthKey)) next.delete(monthKey);
            else next.add(monthKey);
            return next;
        });
    };

    const handleSave = (customIgnore?: boolean) => {
        if (!calculation) return;

        let finalRemarks = formValues.remarks || "";
        const hasWaivers = !!(
            attendanceAdjustments.waiveAll ||
            attendanceAdjustments.waiveAbsent ||
            attendanceAdjustments.waiveUndertime ||
            attendanceAdjustments.waiveSpecialLeave ||
            attendanceAdjustments.waiveSickLeave ||
            attendanceAdjustments.waiveAnnualLeave ||
            attendanceAdjustments.waiveUnapprovedLeave ||
            (attendanceAdjustments.customDeductions &&
                Object.values(attendanceAdjustments.customDeductions).some((v) => v !== undefined))
        );

        if (hasWaivers) {
            const waiverTag = attendanceAdjustments.waiveAll
                ? "[Full salary paid · attendance deductions waived]"
                : "[Attendance deductions adjusted by HR]";
            if (!finalRemarks.includes(waiverTag) && !finalRemarks.includes("waived")) {
                finalRemarks = finalRemarks ? `${finalRemarks} · ${waiverTag}` : waiverTag;
            }
        }

        saveMutation.mutate({
            employeeId,
            month,
            deductionConfig: {
                manualDeductions: formValues.manualDeductions.map((d: any) => ({
                    description: d.description,
                    amount: parseFloat(d.amount) || 0,
                })),
                deductConveyanceOnLeave: true,
            },
            additionalAmounts: {
                bonusAmount: Math.round(parseFloat(formValues.bonus) || 0),
                incentiveAmount: Math.round(parseFloat(formValues.incentive) || 0),
                taxDeduction: Math.round(parseFloat(formValues.tax) || 0),
                advanceDeduction: formValues.advance === "" ? undefined : (parseFloat(formValues.advance) || 0),
                overtimeMultiplier: parseFloat(formValues.overtimeMultiplier) || 1.0,
            },
            arrears: selectedArrearsKeys.size > 0 ? {
                arrearsFromMonths: Array.from(selectedArrearsKeys),
                arrearsAmount: Array.from(selectedArrearsKeys).reduce((sum, key) => {
                    const missed = calculation?.missedCycles?.find(m => m.monthKey === key);
                    return sum + (missed?.amount || 0);
                }, 0),
            } : undefined,
            earlyCutoffDate,
            ignorePastUnmarkedDays: customIgnore ?? ignorePastUnmarkedDays,
            attendanceAdjustments,
            remarks: finalRemarks,
        }, {
            onError: (err: Error) => {
                if (err.message.includes("PAST_UNMARKED_DAYS")) {
                    const days = parseInt(err.message.split(":")[1] || "0", 10);
                    setShowUnmarkedModal({ count: days });
                }
            }
        });
    };

    if (isLoading && !calculation) {
        return (
            <div className="flex flex-1 items-center justify-center min-h-[400px]">
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    if (isError) {
        return (
            <div className="p-4 bg-destructive/10 text-destructive rounded-md flex items-center gap-2 text-sm font-medium">
                <AlertCircle className="size-4" />
                Error: {error?.message}
            </div>
        );
    }

    if (!calculation) return null;

    const totalAttendanceDeduction =
        calculation.absentDeduction +
        calculation.leaveDeduction +
        calculation.notEmployedDeduction;

    return (
        <div className="space-y-6 pb-4 relative">
            {/* Refetch spinner */}
            {isFetching && calculation && (
                <div className="absolute top-0 right-0 p-2 z-50">
                    <Loader2 className="size-4 animate-spin text-primary opacity-70" />
                </div>
            )}

            {isEarlyProcessing && !earlyCutoffDate && cycle && (
                <Alert className="bg-amber-50 border-amber-200">
                    <AlertCircle className="size-4 text-amber-600" />
                    <AlertTitle className="text-amber-800">Early Payroll Generation</AlertTitle>
                    <AlertDescription className="text-amber-700 flex flex-col gap-3 mt-2">
                        <p>
                            The payroll cycle ends on <strong>{format(parseISO(cycle.cycleEnd), "MMM d, yyyy")}</strong>, but today is <strong>{format(parseISO(today), "MMM d, yyyy")}</strong>.
                            <br/>Would you like to generate a pro-rated payslip strictly for the evaluated days up to today?
                        </p>
                        <Button size="sm" variant="outline" className="w-fit border-amber-300 text-amber-800 hover:bg-amber-100 bg-white" onClick={() => setEarlyCutoffDate(today)}>
                            Yes, Generate Pro-rated Slip till Today
                        </Button>
                    </AlertDescription>
                </Alert>
            )}

            {earlyCutoffDate && (
                <Alert className="bg-blue-50 border-blue-200">
                    <Info className="size-4 text-blue-600" />
                    <AlertTitle className="text-blue-800">Pro-rated Evaluation Active</AlertTitle>
                    <AlertDescription className="text-blue-700 flex items-center justify-between mt-1">
                        <span>Generating evaluated payslip strictly up to <strong>{format(parseISO(earlyCutoffDate), "dd MMM yyyy")}</strong>.</span>
                        <Button size="sm" variant="ghost" onClick={() => {
                            setEarlyCutoffDate(undefined);
                            setIgnorePastUnmarkedDays(false);
                        }} className="h-7 text-blue-700 hover:bg-blue-100 hover:text-blue-800 bg-white">
                            Revert to Full Cycle
                        </Button>
                    </AlertDescription>
                </Alert>
            )}

            {/* Header / Employee Summary */}
            <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-4 border rounded-lg p-4 bg-muted/40">
                    <div>
                        <p className="text-xs font-medium text-muted-foreground uppercase">Employee</p>
                        <p className="font-semibold text-sm">{calculation.employeeName}</p>
                        <p className="text-xs text-muted-foreground">{calculation.designation}</p>
                    </div>
                    <div className="text-right">
                        <p className="text-xs font-medium text-muted-foreground uppercase">Cycle</p>
                        <p className="font-semibold text-sm">{format(parseISO(calculation.startDate), "dd MMM")} - {format(parseISO(calculation.endDate), "dd MMM")}</p>
                        <p className="text-xs text-muted-foreground">{calculation.employeeCode}</p>
                    </div>
                </div>

                {/* Arrears Alert */}
                {calculation.missedCycles && calculation.missedCycles.length > 0 && (
                    <Alert className="bg-amber-50 border-amber-200">
                        <AlertCircle className="h-4 w-4 text-amber-600" />
                        <AlertTitle className="text-amber-800 font-semibold mb-1">Unpaid Cycles Detected</AlertTitle>
                        <AlertDescription className="text-amber-700 flex flex-col gap-3">
                            <p className="text-xs">The following historical cycles for this employee are still unpaid. You can roll them forward into this payslip.</p>
                            <div className="flex flex-wrap gap-2">
                                {calculation.missedCycles.map((cycle) => {
                                    const isSelected = selectedArrearsKeys.has(cycle.monthKey);
                                    return (
                                        <Button
                                            key={cycle.monthKey}
                                            size="sm"
                                            variant={isSelected ? "default" : "outline"}
                                            className={cn(
                                                "h-8 text-xs shrink-0",
                                                isSelected
                                                    ? "bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
                                                    : "bg-white border-amber-300 text-amber-900 hover:bg-amber-100"
                                            )}
                                            onClick={() => handleToggleArrears(cycle.monthKey)}
                                        >
                                            {isSelected ? <CheckCircle2 className="size-3 mr-1" /> : <Plus className="size-3 mr-1" />}
                                            {cycle.label}
                                        </Button>
                                    );
                                })}
                            </div>
                            {selectedArrearsKeys.size > 0 && (
                                <p className="text-[10px] font-bold text-amber-800 uppercase tracking-tight">
                                    + PKR {Math.round(Array.from(selectedArrearsKeys).reduce((sum, key) => sum + (calculation.missedCycles?.find(m => m.monthKey === key)?.amount || 0), 0)).toLocaleString()} Total Arrears
                                </p>
                            )}
                        </AlertDescription>
                    </Alert>
                )}
            </div>

            {/* Master Switch: Pay Full Salary / Waive Attendance Deductions */}
            <div
                className={cn(
                    "flex items-center justify-between p-3.5 border rounded-lg transition-colors",
                    attendanceAdjustments.waiveAll
                        ? "bg-emerald-50/80 border-emerald-300 dark:bg-emerald-950/40 dark:border-emerald-800"
                        : "bg-muted/30 border-border"
                )}
            >
                <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">
                            Pay Full Salary (Waive Attendance Deductions)
                        </span>
                        {attendanceAdjustments.waiveAll ? (
                            <Badge className="bg-emerald-600 text-white text-[10px] h-5 px-1.5 hover:bg-emerald-600">
                                Full Salary Active · 0 Deductions
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="text-[10px] h-5 px-1.5 text-muted-foreground">
                                Standard Deductions Active
                            </Badge>
                        )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Waive all attendance penalties (absent, undertime, leave) in a single click. Attendance records remain intact.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Switch
                        checked={!!attendanceAdjustments.waiveAll}
                        onCheckedChange={(checked) => {
                            setAttendanceAdjustments((prev) => ({
                                ...prev,
                                waiveAll: checked,
                            }));
                        }}
                    />
                </div>
            </div>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="w-full grid grid-cols-4 mb-4">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="attendance">Attendance</TabsTrigger>
                    <TabsTrigger value="adjustments">Adjustments</TabsTrigger>
                    <TabsTrigger value="calculations">Calculations</TabsTrigger>
                </TabsList>

                {/* OVERVIEW TAB */}
                <TabsContent value="overview" className="space-y-6">
                    <Card>
                        <CardHeader className="py-2 px-4 border-b bg-muted/30">
                            <CardTitle className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Earnings Summary</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableBody>
                                    <SummaryRow
                                        label="Monthly Base Salary"
                                        value={Object.values(calculation.standardBreakdown).reduce((a, b) => a + b, 0)}
                                        tooltip="Sum of all fixed salary components"
                                    />
                                    {(() => {
                                        const nonDeductibleTotal = Object.entries(calculation.allowanceBreakdown)
                                            .filter(([id]) => id !== "basicSalary" && (calculation.fixedComponents?.[id] ?? false))
                                            .reduce((sum, [, val]) => sum + val, 0);
                                        return nonDeductibleTotal > 0 ? (
                                            <SummaryRow label="Fixed Allowances (non-deductible)" value={nonDeductibleTotal} />
                                        ) : null;
                                    })()}
                                    <SummaryRow label="Overtime Pay" value={calculation.overtimeAmount} highlight />
                                    <SummaryRow label="Incentives & TA/DA" value={calculation.incentiveAmount} highlight />
                                    <SummaryRow label="Commission" value={calculation.commissionAmount} highlight />
                                    <SummaryRow label="Bonus & Eid Allowance" value={calculation.bonusAmount} highlight />
                                    <TableRow className="bg-muted/10 font-semibold">
                                        <TableCell className="py-2.5">Total Gross Earnings</TableCell>
                                        <TableCell className="text-right py-2.5 text-emerald-700">PKR {Math.round(calculation.grossSalary).toLocaleString()}</TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="py-2 px-4 border-b bg-muted/30">
                            <CardTitle className="text-xs font-bold uppercase text-muted-foreground tracking-wider">Deductions Breakdown</CardTitle>
                        </CardHeader>
                        <CardContent className="p-0">
                            <Table>
                                <TableBody>
                                    <SummaryRow
                                        label="Attendance & Proration"
                                        value={totalAttendanceDeduction}
                                        isDeduction
                                        tooltip="Loss of pay due to missing days or short hours"
                                    />
                                    <SummaryRow label="Income Tax" value={calculation.taxDeduction} isDeduction />
                                    <SummaryRow
                                        label={formValues.advance === "" ? "Salary Advance Recovery (Auto)" : "Salary Advance Recovery"}
                                        value={calculation.advanceDeduction}
                                        isDeduction
                                        tooltip={calculation.advanceProcessRecords?.length > 0 ? (
                                            calculation.advanceProcessRecords.map((a: any) => 
                                                `Inst. ${a.installmentNo}/${a.totalInstallments} (Remaining: PKR ${Math.round(a.remainingBalance).toLocaleString()})`
                                            ).join(", ")
                                        ) : undefined}
                                    />
                                    {formValues.advance === "" && calculation.advanceProcessRecords?.map((a: any, i: number) => (
                                        <TableRow key={`adv-detail-${i}`} className="hover:bg-transparent border-0 opacity-60">
                                            <TableCell className="py-0 pl-8 text-[10px] text-muted-foreground italic">
                                                ↳ Installment {a.installmentNo} of {a.totalInstallments} (Balance: PKR {Math.round(a.remainingBalance).toLocaleString()})
                                            </TableCell>
                                            <TableCell className="text-right py-0 text-[10px] font-mono text-rose-600">
                                                - {Math.round(a.installmentAmount).toLocaleString()}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    <SummaryRow label="Other Manual Deductions" value={calculation.otherDeduction} isDeduction />
                                    <TableRow className="bg-muted/10 font-semibold border-t">
                                        <TableCell className="py-2.5">Total Deductions</TableCell>
                                        <TableCell className="text-right py-2.5 text-rose-600">
                                            - PKR {Math.round(calculation.totalDeductions).toLocaleString()}
                                        </TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>

                    {/* Net Pay */}
                    <div className="flex items-center justify-between p-5 bg-primary/5 border border-primary/20 rounded-xl ">
                        <div className="space-y-0.5">
                            <p className="text-sm font-bold text-primary flex items-center gap-2 uppercase tracking-wide">
                                Net Payable Amount
                            </p>
                            <p className="text-xs text-muted-foreground">Final amount to be credited to employee</p>
                        </div>
                        <div className="text-right">
                            <p className="text-3xl font-extrabold text-primary tracking-tight">PKR {Math.round(calculation.netSalary).toLocaleString()}</p>
                        </div>
                    </div>
                </TabsContent>

                {/* ATTENDANCE TAB */}
                <TabsContent value="attendance" className="space-y-6">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                        <StatCard
                            label="Total Job Days"
                            value={calculation.totalWorkingDays}
                            tooltip="Calendar days minus holidays in this cycle"
                        />
                        <StatCard
                            label="Present"
                            value={calculation.daysPresent}
                            className={cn(
                                "bg-emerald-50 border-emerald-100 text-emerald-700",
                                calculation.daysPresent > calculation.totalWorkingDays && "ring-2 ring-emerald-500 ring-offset-2"
                            )}
                            tooltip={calculation.daysPresent > calculation.totalWorkingDays ? "Includes working on weekends/holidays" : undefined}
                        />
                        <StatCard label="Absent" value={calculation.daysAbsent} className="bg-rose-50 border-rose-100 text-rose-700" />
                        <StatCard
                            label="Unmarked Days"
                            value={calculation.unmarkedDays}
                            className={calculation.unmarkedDays > 0 ? "bg-rose-50 border-rose-500 text-rose-800 ring-2 ring-rose-500 animate-pulse" : ""}
                            tooltip="Days with no attendance records! Please fix in Attendance."
                        />
                        <StatCard label="Annual Leave" value={calculation.daysAnnualLeave} className="bg-amber-50 border-amber-100 text-amber-700" />
                        <StatCard label="Sick Leave" value={calculation.daysSickLeave} className="bg-amber-50 border-amber-100 text-amber-700" />
                        <StatCard label="Special Leave" value={calculation.daysSpecialLeave} className="bg-amber-50 border-amber-100 text-amber-700" />
                        <StatCard label="Unapproved Leave" value={calculation.daysUnapprovedLeave} className="bg-rose-50 border-rose-100 text-rose-700" tooltip="Conveyance deducted" />
                        <StatCard
                            label="Undertime (Hrs)"
                            value={calculation.totalUndertimeHours}
                            className={calculation.totalUndertimeHours > 0 ? "bg-amber-50 border-amber-100 text-amber-700" : ""}
                        />
                        <StatCard label="Overtime (Hrs)" value={calculation.totalOvertimeHours} className="bg-blue-50 border-blue-100 text-blue-700" />
                    </div>

                    {calculation.daysPresent > calculation.totalWorkingDays && (
                        <div className="p-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-lg text-xs flex items-center gap-2">
                            <Info className="size-4 shrink-0" />
                            Employee worked {calculation.daysPresent - calculation.totalWorkingDays} extra day(s) beyond the standard job cycle.
                        </div>
                    )}

                    {/* Bradford Factor */}
                    <Card>
                        <CardHeader className="py-2 px-4 border-b bg-muted/30">
                            <CardTitle className="text-xs font-bold uppercase text-muted-foreground tracking-wider flex items-center gap-2">
                                <ShieldAlert className="size-3.5" />
                                Bradford Factor
                                {(() => {
                                    const annualRaw = calculation.yearlyBradfordScore;
                                    const hasAnnual = annualRaw != null;
                                    return hasAnnual ? (
                                        <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-wide">
                                            Annual
                                        </Badge>
                                    ) : null;
                                })()}
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                                <div className="space-y-1">
                                    <p className="text-xs text-muted-foreground">Absence pattern score (B = S² × D)</p>
                                    {(() => {
                                        const annualRaw = calculation.yearlyBradfordScore;
                                        const hasAnnual = annualRaw != null;
                                        const periodYear = parseISO(`${month}-01`).getFullYear();
                                        return (
                                            <p className="text-xs text-muted-foreground">
                                                Period: {hasAnnual
                                                    ? `1 Jan ${periodYear} to 31 Dec ${periodYear}`
                                                    : calculation.bradfordFactorPeriod}
                                            </p>
                                        );
                                    })()}
                                </div>
                                <div className="text-right">
                                    {(() => {
                                        // Prefer annual score whenever it is present; otherwise cycle score.
                                        const annualRaw = calculation.yearlyBradfordScore;
                                        const score = (annualRaw != null)
                                            ? Number(annualRaw)
                                            : calculation.bradfordFactorScore;
                                        return (
                                            <>
                                                <p className={cn(
                                                    "text-3xl font-extrabold tracking-tight",
                                                    score === 0 && "text-emerald-600",
                                                    score > 0 && score < 50 && "text-amber-600",
                                                    score >= 50 && score < 250 && "text-orange-600",
                                                    score >= 250 && "text-rose-600",
                                                )}>
                                                    {score}
                                                </p>
                                                <Badge
                                                    variant="outline"
                                                    className={cn(
                                                        "text-[10px] mt-1",
                                                        score === 0 && "border-emerald-200 text-emerald-700 bg-emerald-50",
                                                        score > 0 && score < 50 && "border-amber-200 text-amber-700 bg-amber-50",
                                                        score >= 50 && score < 250 && "border-orange-200 text-orange-700 bg-orange-50",
                                                        score >= 250 && "border-rose-200 text-rose-700 bg-rose-50",
                                                    )}
                                                >
                                                    {score === 0 ? "Excellent" : score < 50 ? "Acceptable" : score < 250 ? "Concerning" : "Critical"}
                                                </Badge>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                            <div className="mt-3 pt-3 border-t text-[10px] text-muted-foreground space-y-0.5">
                                <p><strong>S</strong> = number of separate absence spells (consecutive absents count as 1 spell)</p>
                                <p><strong>D</strong> = total absent-equivalent days (half-days count as 0.5)</p>
                                <p>Thresholds: 0 = Excellent, &lt;50 = Acceptable, &lt;250 = Concerning, 250+ = Critical</p>
                            </div>
                        </CardContent>
                    </Card>

                    <p className="text-[10px] text-center text-muted-foreground border-t pt-2 uppercase font-medium ">
                        Verified Attendance Records
                    </p>
                </TabsContent>

                {/* ADJUSTMENTS TAB */}
                <TabsContent value="adjustments" className="space-y-6">
                    {/* Attendance Deductions & Selective Waivers Card */}
                    <Card className="border-border">
                        <CardHeader className="py-3 px-4 bg-muted/20 border-b flex flex-row items-center justify-between">
                            <div>
                                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                                    <Calculator className="size-4 text-primary" />
                                    Attendance Deductions & Selective Waivers
                                </CardTitle>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    Uncheck any occasion to waive its deduction completely, or specify custom override amounts.
                                </p>
                            </div>
                            {attendanceAdjustments.waiveAll ? (
                                <Badge className="bg-emerald-600 text-white text-xs">All Waived (Full Salary)</Badge>
                            ) : (
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-7 text-xs"
                                    onClick={() => {
                                        setAttendanceAdjustments({});
                                    }}
                                >
                                    Reset to Calculated
                                </Button>
                            )}
                        </CardHeader>
                        <CardContent className="p-4 space-y-4">
                            {attendanceAdjustments.waiveAll ? (
                                <div className="p-3.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                                    <div className="flex items-center gap-2">
                                        <CheckCircle2 className="size-4 text-emerald-600 shrink-0" />
                                        <span>Master switch is ON. All attendance misconduct and short hour penalties are currently waived.</span>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 text-xs text-emerald-700 hover:bg-emerald-100 bg-white border border-emerald-200"
                                        onClick={() => setAttendanceAdjustments((prev) => ({ ...prev, waiveAll: false }))}
                                    >
                                        Use Selective Controls
                                    </Button>
                                </div>
                            ) : (
                                (() => {
                                    const occasionItems = [
                                        {
                                            key: "absent" as const,
                                            label: "Full Day Absent",
                                            countLabel: `${calculation.daysAbsent} day(s)`,
                                            hasOccurrences: calculation.daysAbsent > 0,
                                            unadjustedAmt: calculation.unadjustedOccasionDeductions?.absent ?? calculation.deductionBreakdownByOccasion?.absent ?? 0,
                                            currentAmt: calculation.deductionBreakdownByOccasion?.absent ?? calculation.absentDeduction,
                                            waived: !!attendanceAdjustments.waiveAbsent,
                                            waiveKey: "waiveAbsent" as const,
                                        },
                                        {
                                            key: "undertime" as const,
                                            label: "Undertime (Short Hours)",
                                            countLabel: `${calculation.totalUndertimeHours} hrs`,
                                            hasOccurrences: calculation.totalUndertimeHours > 0,
                                            unadjustedAmt: calculation.unadjustedOccasionDeductions?.undertime ?? calculation.deductionBreakdownByOccasion?.undertime ?? 0,
                                            currentAmt: calculation.deductionBreakdownByOccasion?.undertime ?? 0,
                                            waived: !!attendanceAdjustments.waiveUndertime,
                                            waiveKey: "waiveUndertime" as const,
                                        },
                                        {
                                            key: "specialLeave" as const,
                                            label: "Special Leave (Allowances)",
                                            countLabel: `${calculation.daysSpecialLeave} day(s)`,
                                            hasOccurrences: calculation.daysSpecialLeave > 0,
                                            unadjustedAmt: calculation.unadjustedOccasionDeductions?.specialLeave ?? calculation.deductionBreakdownByOccasion?.specialLeave ?? 0,
                                            currentAmt: calculation.deductionBreakdownByOccasion?.specialLeave ?? 0,
                                            waived: !!attendanceAdjustments.waiveSpecialLeave,
                                            waiveKey: "waiveSpecialLeave" as const,
                                        },
                                        {
                                            key: "sickLeave" as const,
                                            label: "Sick Leave",
                                            countLabel: `${calculation.daysSickLeave} day(s)`,
                                            hasOccurrences: calculation.daysSickLeave > 0,
                                            unadjustedAmt: calculation.unadjustedOccasionDeductions?.sickLeave ?? calculation.deductionBreakdownByOccasion?.sickLeave ?? 0,
                                            currentAmt: calculation.deductionBreakdownByOccasion?.sickLeave ?? 0,
                                            waived: !!attendanceAdjustments.waiveSickLeave,
                                            waiveKey: "waiveSickLeave" as const,
                                        },
                                        {
                                            key: "annualLeave" as const,
                                            label: "Annual Leave Allowance Penalty",
                                            countLabel: `${calculation.daysAnnualLeave} day(s)`,
                                            hasOccurrences: calculation.daysAnnualLeave > 0,
                                            unadjustedAmt: calculation.unadjustedOccasionDeductions?.annualLeave ?? calculation.deductionBreakdownByOccasion?.annualLeave ?? 0,
                                            currentAmt: calculation.deductionBreakdownByOccasion?.annualLeave ?? 0,
                                            waived: !!attendanceAdjustments.waiveAnnualLeave,
                                            waiveKey: "waiveAnnualLeave" as const,
                                        },
                                        {
                                            key: "unapprovedLeave" as const,
                                            label: "Unapproved Leave",
                                            countLabel: `${calculation.daysUnapprovedLeave} day(s)`,
                                            hasOccurrences: calculation.daysUnapprovedLeave > 0,
                                            unadjustedAmt: calculation.unadjustedOccasionDeductions?.unapprovedLeave ?? calculation.deductionBreakdownByOccasion?.unapprovedLeave ?? 0,
                                            currentAmt: calculation.deductionBreakdownByOccasion?.unapprovedLeave ?? calculation.leaveDeduction,
                                            waived: !!attendanceAdjustments.waiveUnapprovedLeave,
                                            waiveKey: "waiveUnapprovedLeave" as const,
                                        },
                                    ];

                                    const visibleItems = occasionItems.filter(item => item.hasOccurrences || item.unadjustedAmt > 0);

                                    if (visibleItems.length === 0) {
                                        return (
                                            <p className="text-xs text-muted-foreground italic py-2 text-center">
                                                No attendance misconduct or penalties recorded for this employee in this cycle.
                                            </p>
                                        );
                                    }

                                    return (
                                        <div className="space-y-3">
                                            {visibleItems.map((item) => {
                                                const customValue = attendanceAdjustments.customDeductions?.[item.key];
                                                const hasCustom = !item.waived && customValue !== undefined;

                                                return (
                                                    <div
                                                        key={item.key}
                                                        className={cn(
                                                            "p-3 rounded-lg border transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3",
                                                            item.waived
                                                                ? "bg-emerald-50/40 border-emerald-200"
                                                                : hasCustom
                                                                    ? "bg-blue-50/40 border-blue-200"
                                                                    : "bg-background border-border"
                                                        )}
                                                    >
                                                        <div className="flex items-start gap-3">
                                                            <Checkbox
                                                                id={`apply-${item.key}`}
                                                                checked={!item.waived}
                                                                onCheckedChange={(checked) => {
                                                                    setAttendanceAdjustments((prev) => ({
                                                                        ...prev,
                                                                        [item.waiveKey]: !checked,
                                                                    }));
                                                                }}
                                                                className="mt-0.5"
                                                            />
                                                            <div>
                                                                <label
                                                                    htmlFor={`apply-${item.key}`}
                                                                    className="text-xs font-semibold cursor-pointer flex items-center gap-2 flex-wrap"
                                                                >
                                                                    <span>Apply {item.label}</span>
                                                                    <Badge variant="outline" className="text-[10px] h-4 px-1 border-border">
                                                                        {item.countLabel}
                                                                    </Badge>
                                                                    {item.waived && (
                                                                        <Badge className="bg-emerald-600 text-white text-[9px] h-4 px-1">
                                                                            WAIVED (PKR 0)
                                                                        </Badge>
                                                                    )}
                                                                    {hasCustom && (
                                                                        <Badge className="bg-blue-600 text-white text-[9px] h-4 px-1">
                                                                            CUSTOM OVERRIDE
                                                                        </Badge>
                                                                    )}
                                                                </label>
                                                                <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">
                                                                    Calculated: - PKR {Math.round(item.unadjustedAmt).toLocaleString()}
                                                                    {item.waived && (
                                                                        <span className="text-emerald-700 font-semibold ml-1.5">
                                                                            → 0 (waived)
                                                                        </span>
                                                                    )}
                                                                    {hasCustom && (
                                                                        <span className="text-blue-700 font-semibold ml-1.5">
                                                                            → - PKR {Math.round(item.currentAmt).toLocaleString()} (override)
                                                                        </span>
                                                                    )}
                                                                </p>
                                                            </div>
                                                        </div>

                                                        {!item.waived && (
                                                            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                                                                <span className="text-[11px] text-muted-foreground whitespace-nowrap">
                                                                    Override PKR:
                                                                </span>
                                                                <Input
                                                                    type="number"
                                                                    min={0}
                                                                    placeholder={Math.round(item.unadjustedAmt).toString()}
                                                                    value={customValue ?? ""}
                                                                    onChange={(e: ChangeEvent<HTMLInputElement>) => {
                                                                        const val = e.target.value.trim();
                                                                        setAttendanceAdjustments((prev) => {
                                                                            const prevCustom = { ...(prev.customDeductions || {}) };
                                                                            if (val === "") {
                                                                                delete prevCustom[item.key];
                                                                            } else {
                                                                                prevCustom[item.key] = Math.max(0, parseFloat(val) || 0);
                                                                            }
                                                                            return {
                                                                                ...prev,
                                                                                customDeductions: prevCustom,
                                                                            };
                                                                        });
                                                                    }}
                                                                    className="w-28 h-8 text-xs font-mono"
                                                                />
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                })()
                            )}
                        </CardContent>
                    </Card>

                    <Separator className="my-2" />

                    <FieldGroup>
                        <form.Field name="overtimeMultiplier">
                            {(field) => (
                                <Field className="mb-4">
                                    <FieldLabel className="flex items-center gap-2">
                                        Overtime Multiplier Rate
                                        <TooltipProvider>
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <Info className="size-3 text-muted-foreground" />
                                                </TooltipTrigger>
                                                <TooltipContent className="max-w-[200px] text-xs">
                                                    Standard is 1.0x of hourly basic rate. Change here if overtime payout should be at 1.5x or 2.0x.
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </FieldLabel>
                                    <Input
                                        type="number"
                                        step="0.1"
                                        value={field.state.value}
                                        onChange={(e: ChangeEvent<HTMLInputElement>) => field.handleChange(e.target.value)}
                                        placeholder="1.0"
                                        className="w-24 border-primary/30"
                                    />
                                </Field>
                            )}
                        </form.Field>

                        <Separator className="my-4" />

                        <div className="grid grid-cols-2 gap-4">
                            <form.Field name="bonus">
                                {(field) => (
                                    <Field>
                                        <FieldLabel>Bonus Amount</FieldLabel>
                                        <Input
                                            type="number"
                                            value={field.state.value}
                                            onChange={(e: ChangeEvent<HTMLInputElement>) => field.handleChange(e.target.value)}
                                            placeholder="0"
                                        />
                                    </Field>
                                )}
                            </form.Field>
                            <form.Field name="incentive">
                                {(field) => (
                                    <Field>
                                        <FieldLabel>Incentive / Arrears</FieldLabel>
                                        <Input
                                            type="number"
                                            value={field.state.value}
                                            onChange={(e: ChangeEvent<HTMLInputElement>) => field.handleChange(e.target.value)}
                                            placeholder="0"
                                        />
                                    </Field>
                                )}
                            </form.Field>
                            <form.Field name="tax">
                                {(field) => (
                                    <Field>
                                        <FieldLabel>Income Tax</FieldLabel>
                                        <Input
                                            type="number"
                                            value={field.state.value}
                                            onChange={(e: ChangeEvent<HTMLInputElement>) => field.handleChange(e.target.value)}
                                            placeholder="0"
                                        />
                                    </Field>
                                )}
                            </form.Field>
                            <form.Field name="advance">
                                {(field) => (
                                    <Field>
                                        <FieldLabel>Salary Advance Deduction</FieldLabel>
                                        <Input
                                            type="number"
                                            value={field.state.value}
                                            onChange={(e: ChangeEvent<HTMLInputElement>) => field.handleChange(e.target.value)}
                                            placeholder="0"
                                        />
                                    </Field>
                                )}
                            </form.Field>
                        </div>

                        <Separator className="my-2" />

                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-medium">Other Manual Deductions</h3>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={() => form.pushFieldValue("manualDeductions", { description: "", amount: "" })}
                                    className="h-8 text-xs"
                                >
                                    <Plus className="size-3 mr-1" /> Add
                                </Button>
                            </div>

                            <form.Field name="manualDeductions">
                                {(field) => (
                                    <div className="space-y-3">
                                        {field.state.value.map((_, i) => (
                                            <div key={i} className="flex gap-2 items-start">
                                                <form.Field name={`manualDeductions[${i}].description`}>
                                                    {(subField) => (
                                                        <Input
                                                            placeholder="Description"
                                                            value={subField.state.value}
                                                            onChange={(e: ChangeEvent<HTMLInputElement>) => subField.handleChange(e.target.value)}
                                                            className="flex-1"
                                                        />
                                                    )}
                                                </form.Field>
                                                <form.Field name={`manualDeductions[${i}].amount`}>
                                                    {(subField) => (
                                                        <Input
                                                            type="number"
                                                            placeholder="Amount"
                                                            value={subField.state.value}
                                                            onChange={(e: ChangeEvent<HTMLInputElement>) => subField.handleChange(e.target.value)}
                                                            className="w-24"
                                                        />
                                                    )}
                                                </form.Field>
                                                <Button
                                                    size="icon"
                                                    variant="ghost"
                                                    className="shrink-0 text-muted-foreground hover:text-destructive"
                                                    onClick={() => form.removeFieldValue("manualDeductions", i)}
                                                >
                                                    <Trash2 className="size-4" />
                                                </Button>
                                            </div>
                                        ))}
                                        {field.state.value.length === 0 && (
                                            <p className="text-xs text-muted-foreground italic">No manual deductions added.</p>
                                        )}
                                    </div>
                                )}
                            </form.Field>
                        </div>
                    </FieldGroup>
                </TabsContent>

                {/* CALCULATIONS TAB */}
                <TabsContent value="calculations" className="space-y-5 text-sm">
                    <CalcSection step="Step 1" title="Base Rates" color="blue">
                        <CalcRow
                            label="Standard Salary (Contract)"
                            formula="All components combined"
                            result={`PKR ${Math.round(Object.values(calculation.standardBreakdown).reduce((a, b) => a + b, 0)).toLocaleString()}`}
                        />
                        <CalcRow
                            label="Total Working Days (this cycle)"
                            formula={(() => {
                                const restDays = calculation.calculationMeta.restDays ?? [0];
                                const restDesc =
                                    restDays.length === 1 && restDays[0] === 0
                                        ? "6 days/wk (Mon–Sat)"
                                        : restDays.length === 2 && restDays.includes(0) && restDays.includes(6)
                                            ? "5 days/wk (Mon–Fri)"
                                            : "Scheduled days";
                                return `${restDesc} between ${format(parseISO(calculation.startDate), "dd MMM")} – ${format(parseISO(calculation.endDate), "dd MMM")}`;
                            })()}
                            result={`${calculation.totalWorkingDays} days`}
                        />
                        <CalcRow
                            label="Standard Duty Hours / Day"
                            formula="Configured per employee"
                            result={`${calculation.calculationMeta.standardDutyHours} hrs`}
                        />
                        <div className="mt-2 p-3 bg-blue-50 border border-blue-100 rounded-lg space-y-1 font-mono text-xs">
                            <p className="text-blue-800 font-semibold mb-1">Derived Rates:</p>
                            <p>Per Day Basic = {Math.round(calculation.standardBreakdown.basicSalary).toLocaleString()} ÷ {calculation.totalWorkingDays} = <span className="font-bold">{calculation.calculationMeta.perDayBasic.toFixed(2)}</span></p>
                            <p>Per Hour Basic = {calculation.calculationMeta.perDayBasic.toFixed(2)} ÷ {calculation.calculationMeta.standardDutyHours} = <span className="font-bold">{calculation.calculationMeta.perHourBasic.toFixed(2)}</span></p>
                        </div>
                    </CalcSection>

                    <CalcSection step="Step 2" title="Salary Component Breakdown" color="slate">
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs border-collapse">
                                <thead>
                                    <tr className="bg-muted/40 text-muted-foreground">
                                        <th className="text-left py-1.5 px-2 font-semibold">Component</th>
                                        <th className="text-right py-1.5 px-2 font-semibold">Standard</th>
                                        <th className="text-right py-1.5 px-2 font-semibold text-rose-600">Deducted</th>
                                        <th className="text-right py-1.5 px-2 font-semibold text-emerald-700">Adjusted</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-border/50">
                                    {Object.entries(calculation.standardBreakdown)
                                        .filter(([, stdVal]) => stdVal > 0)
                                        .map(([id, stdVal]) => {
                                            const adjVal = calculation.adjustedBreakdown?.[id] ?? (calculation.allowanceBreakdown[id] ?? stdVal);
                                            const deducted = calculation.componentDeductions?.[id] ?? (stdVal - adjVal);
                                            const name = calculation.allowanceNames?.[id] ?? getAllowanceLabel(id);
                                            const isFixed = deducted === 0 && (calculation.fixedComponents?.[id] ?? false);
                                            return (
                                                <tr key={id} className="hover:bg-muted/20">
                                                    <td className="py-1.5 px-2 text-muted-foreground">
                                                        {name}
                                                        {isFixed && (
                                                            <span className="ml-1.5 text-[9px] text-muted-foreground/60 italic">(non-deductible)</span>
                                                        )}
                                                    </td>
                                                    <td className="py-1.5 px-2 text-right font-mono">{Math.round(stdVal).toLocaleString()}</td>
                                                    <td className={`py-1.5 px-2 text-right font-mono ${deducted > 0 ? "text-rose-600" : "text-muted-foreground"}`}>
                                                        {deducted > 0 ? `- ${Math.round(deducted).toLocaleString()}` : "—"}
                                                    </td>
                                                    <td className="py-1.5 px-2 text-right font-mono font-semibold text-emerald-700">{Math.round(adjVal).toLocaleString()}</td>
                                                </tr>
                                            );
                                        })}
                                </tbody>
                            </table>
                        </div>
                    </CalcSection>

                    <CalcSection step="Step 3" title="Attendance Deduction Rules Applied" color="rose">
                        <div className="space-y-3 text-xs">
                            {calculation.daysNotEmployed > 0 && (
                                <div className="p-3 rounded-lg border border-orange-100 bg-orange-50/50 space-y-1">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center">
                                            <span className="font-semibold text-orange-800">Pre-Joining / Cutoff Proration</span>
                                            <BreakdownExplanationDialog title="Pre-Joining/Cutoff" log={calculation.explanationLog} typeKeys={["not_employed"]} />
                                        </div>
                                        <Badge variant="outline" className="text-[10px] border-orange-200 text-orange-700 bg-white">{calculation.daysNotEmployed} day(s)</Badge>
                                    </div>
                                    <p className="text-muted-foreground font-mono leading-relaxed">
                                        {calculation.daysNotEmployed} × Per Day Rate (Basic + allowances): - PKR {Math.round(calculation.deductionBreakdownByOccasion?.notEmployed ?? calculation.notEmployedDeduction).toLocaleString()}
                                    </p>
                                </div>
                            )}
                            {calculation.daysAbsent > 0 && (() => {
                                const isWaived = !!(attendanceAdjustments.waiveAll || attendanceAdjustments.waiveAbsent);
                                const customAmt = attendanceAdjustments.customDeductions?.absent;
                                const isCustom = !isWaived && customAmt !== undefined;
                                const currentAmt = calculation.deductionBreakdownByOccasion?.absent ?? calculation.absentDeduction;
                                const origAmt = calculation.unadjustedOccasionDeductions?.absent ?? currentAmt;

                                return (
                                    <div className={cn(
                                        "p-3 rounded-lg border space-y-1 transition-colors",
                                        isWaived
                                            ? "border-emerald-200 bg-emerald-50/40"
                                            : isCustom
                                                ? "border-blue-200 bg-blue-50/40"
                                                : "border-rose-100 bg-rose-50/50"
                                    )}>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className={cn(
                                                    "font-semibold",
                                                    isWaived ? "text-emerald-800" : isCustom ? "text-blue-800" : "text-rose-800"
                                                )}>
                                                    Full Day Absent
                                                </span>
                                                <BreakdownExplanationDialog title="Full Day Absent" log={calculation.explanationLog} typeKeys={["absent"]} />
                                                {isWaived && (
                                                    <Badge className="bg-emerald-600 text-white text-[9px] h-4 px-1">WAIVED BY HR</Badge>
                                                )}
                                                {isCustom && (
                                                    <Badge className="bg-blue-600 text-white text-[9px] h-4 px-1">ADJUSTED BY HR</Badge>
                                                )}
                                            </div>
                                            <Badge variant="outline" className="text-[10px] border-border bg-white">{calculation.daysAbsent} day(s)</Badge>
                                        </div>
                                        <p className="text-muted-foreground font-mono leading-relaxed">
                                            {isWaived ? (
                                                <span>
                                                    <span className="line-through text-muted-foreground/60">Original: - PKR {Math.round(origAmt).toLocaleString()}</span>
                                                    {" "}→{" "}
                                                    <strong className="text-emerald-700">- PKR 0</strong> (Waived)
                                                </span>
                                            ) : isCustom ? (
                                                <span>
                                                    <span className="line-through text-muted-foreground/60">Calculated: - PKR {Math.round(origAmt).toLocaleString()}</span>
                                                    {" "}→{" "}
                                                    <strong className="text-blue-700">- PKR {Math.round(currentAmt).toLocaleString()}</strong> (Custom Override)
                                                </span>
                                            ) : (
                                                <span>
                                                    {calculation.daysAbsent} × Per Day Rate (Basic + configured allowances): <strong className="text-rose-700">- PKR {Math.round(currentAmt).toLocaleString()}</strong>
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                );
                            })()}

                            {calculation.totalUndertimeHours > 0 && (() => {
                                const isWaived = !!(attendanceAdjustments.waiveAll || attendanceAdjustments.waiveUndertime);
                                const customAmt = attendanceAdjustments.customDeductions?.undertime;
                                const isCustom = !isWaived && customAmt !== undefined;
                                const currentAmt = calculation.deductionBreakdownByOccasion?.undertime ?? 0;
                                const origAmt = calculation.unadjustedOccasionDeductions?.undertime ?? currentAmt;

                                return (
                                    <div className={cn(
                                        "p-3 rounded-lg border space-y-1 transition-colors",
                                        isWaived
                                            ? "border-emerald-200 bg-emerald-50/40"
                                            : isCustom
                                                ? "border-blue-200 bg-blue-50/40"
                                                : "border-amber-100 bg-amber-50/50"
                                    )}>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className={cn(
                                                    "font-semibold",
                                                    isWaived ? "text-emerald-800" : isCustom ? "text-blue-800" : "text-amber-800"
                                                )}>
                                                    Undertime (Short Hours)
                                                </span>
                                                <BreakdownExplanationDialog title="Undertime / Late / Early" log={calculation.explanationLog} typeKeys={["undertime", "lateArrival", "earlyLeaving"]} />
                                                {isWaived && (
                                                    <Badge className="bg-emerald-600 text-white text-[9px] h-4 px-1">WAIVED BY HR</Badge>
                                                )}
                                                {isCustom && (
                                                    <Badge className="bg-blue-600 text-white text-[9px] h-4 px-1">ADJUSTED BY HR</Badge>
                                                )}
                                            </div>
                                            <Badge variant="outline" className="text-[10px] border-border bg-white">{calculation.totalUndertimeHours} hrs</Badge>
                                        </div>
                                        <p className="text-muted-foreground font-mono leading-relaxed">
                                            {isWaived ? (
                                                <span>
                                                    <span className="line-through text-muted-foreground/60">Original: - PKR {Math.round(origAmt).toLocaleString()}</span>
                                                    {" "}→{" "}
                                                    <strong className="text-emerald-700">- PKR 0</strong> (Waived)
                                                </span>
                                            ) : isCustom ? (
                                                <span>
                                                    <span className="line-through text-muted-foreground/60">Calculated: - PKR {Math.round(origAmt).toLocaleString()}</span>
                                                    {" "}→{" "}
                                                    <strong className="text-blue-700">- PKR {Math.round(currentAmt).toLocaleString()}</strong> (Custom Override)
                                                </span>
                                            ) : (
                                                <span>
                                                    {calculation.totalUndertimeHours} hrs × Hourly Rate (Basic + configured allowances): <strong className="text-amber-800">- PKR {Math.round(currentAmt).toLocaleString()}</strong>
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                );
                            })()}

                            {calculation.daysSpecialLeave > 0 && ((calculation.unadjustedOccasionDeductions?.specialLeave ?? 0) > 0 || (calculation.deductionBreakdownByOccasion?.specialLeave ?? 0) > 0) && (() => {
                                const isWaived = !!(attendanceAdjustments.waiveAll || attendanceAdjustments.waiveSpecialLeave);
                                const customAmt = attendanceAdjustments.customDeductions?.specialLeave;
                                const isCustom = !isWaived && customAmt !== undefined;
                                const currentAmt = calculation.deductionBreakdownByOccasion?.specialLeave ?? 0;
                                const origAmt = calculation.unadjustedOccasionDeductions?.specialLeave ?? currentAmt;

                                return (
                                    <div className={cn(
                                        "p-3 rounded-lg border space-y-1 transition-colors",
                                        isWaived
                                            ? "border-emerald-200 bg-emerald-50/40"
                                            : isCustom
                                                ? "border-blue-200 bg-blue-50/40"
                                                : "border-orange-100 bg-orange-50/50"
                                    )}>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className={cn(
                                                    "font-semibold",
                                                    isWaived ? "text-emerald-800" : isCustom ? "text-blue-800" : "text-orange-800"
                                                )}>
                                                    Special Leave (Allowances Deducted)
                                                </span>
                                                <BreakdownExplanationDialog title="Special Leave" log={calculation.explanationLog} typeKeys={["specialLeave"]} />
                                                {isWaived && (
                                                    <Badge className="bg-emerald-600 text-white text-[9px] h-4 px-1">WAIVED BY HR</Badge>
                                                )}
                                                {isCustom && (
                                                    <Badge className="bg-blue-600 text-white text-[9px] h-4 px-1">ADJUSTED BY HR</Badge>
                                                )}
                                            </div>
                                            <Badge variant="outline" className="text-[10px] border-border bg-white">{calculation.daysSpecialLeave} day(s)</Badge>
                                        </div>
                                        <p className="text-muted-foreground font-mono leading-relaxed">
                                            {isWaived ? (
                                                <span>
                                                    <span className="line-through text-muted-foreground/60">Original: - PKR {Math.round(origAmt).toLocaleString()}</span>
                                                    {" "}→{" "}
                                                    <strong className="text-emerald-700">- PKR 0</strong> (Waived)
                                                </span>
                                            ) : isCustom ? (
                                                <span>
                                                    <span className="line-through text-muted-foreground/60">Calculated: - PKR {Math.round(origAmt).toLocaleString()}</span>
                                                    {" "}→{" "}
                                                    <strong className="text-blue-700">- PKR {Math.round(currentAmt).toLocaleString()}</strong> (Custom Override)
                                                </span>
                                            ) : (
                                                <span>
                                                    {calculation.daysSpecialLeave} × Per Day Rate (Basic paid; allowances with Special Leave rule deducted): <strong className="text-orange-800">- PKR {Math.round(currentAmt).toLocaleString()}</strong>
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                );
                            })()}

                            {calculation.daysSickLeave > 0 && ((calculation.unadjustedOccasionDeductions?.sickLeave ?? 0) > 0 || (calculation.deductionBreakdownByOccasion?.sickLeave ?? 0) > 0) && (() => {
                                const isWaived = !!(attendanceAdjustments.waiveAll || attendanceAdjustments.waiveSickLeave);
                                const customAmt = attendanceAdjustments.customDeductions?.sickLeave;
                                const isCustom = !isWaived && customAmt !== undefined;
                                const currentAmt = calculation.deductionBreakdownByOccasion?.sickLeave ?? 0;
                                const origAmt = calculation.unadjustedOccasionDeductions?.sickLeave ?? currentAmt;

                                return (
                                    <div className={cn(
                                        "p-3 rounded-lg border space-y-1 transition-colors",
                                        isWaived
                                            ? "border-emerald-200 bg-emerald-50/40"
                                            : isCustom
                                                ? "border-blue-200 bg-blue-50/40"
                                                : "border-teal-100 bg-teal-50/50"
                                    )}>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className={cn(
                                                    "font-semibold",
                                                    isWaived ? "text-emerald-800" : isCustom ? "text-blue-800" : "text-teal-800"
                                                )}>
                                                    Sick Leave Deduction
                                                </span>
                                                <BreakdownExplanationDialog title="Sick Leave" log={calculation.explanationLog} typeKeys={["sickLeave"]} />
                                                {isWaived && (
                                                    <Badge className="bg-emerald-600 text-white text-[9px] h-4 px-1">WAIVED BY HR</Badge>
                                                )}
                                                {isCustom && (
                                                    <Badge className="bg-blue-600 text-white text-[9px] h-4 px-1">ADJUSTED BY HR</Badge>
                                                )}
                                            </div>
                                            <Badge variant="outline" className="text-[10px] border-border bg-white">{calculation.daysSickLeave} day(s)</Badge>
                                        </div>
                                        <p className="text-muted-foreground font-mono leading-relaxed">
                                            {isWaived ? (
                                                <span>
                                                    <span className="line-through text-muted-foreground/60">Original: - PKR {Math.round(origAmt).toLocaleString()}</span>
                                                    {" "}→{" "}
                                                    <strong className="text-emerald-700">- PKR 0</strong> (Waived)
                                                </span>
                                            ) : isCustom ? (
                                                <span>
                                                    <span className="line-through text-muted-foreground/60">Calculated: - PKR {Math.round(origAmt).toLocaleString()}</span>
                                                    {" "}→{" "}
                                                    <strong className="text-blue-700">- PKR {Math.round(currentAmt).toLocaleString()}</strong> (Custom Override)
                                                </span>
                                            ) : (
                                                <span>
                                                    {calculation.daysSickLeave} × Per Day Rate (Configured allowances): <strong className="text-teal-800">- PKR {Math.round(currentAmt).toLocaleString()}</strong>
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                );
                            })()}

                            {calculation.daysAnnualLeave > 0 && ((calculation.unadjustedOccasionDeductions?.annualLeave ?? 0) > 0 || (calculation.deductionBreakdownByOccasion?.annualLeave ?? 0) > 0) && (() => {
                                const isWaived = !!(attendanceAdjustments.waiveAll || attendanceAdjustments.waiveAnnualLeave);
                                const customAmt = attendanceAdjustments.customDeductions?.annualLeave;
                                const isCustom = !isWaived && customAmt !== undefined;
                                const currentAmt = calculation.deductionBreakdownByOccasion?.annualLeave ?? 0;
                                const origAmt = calculation.unadjustedOccasionDeductions?.annualLeave ?? currentAmt;

                                return (
                                    <div className={cn(
                                        "p-3 rounded-lg border space-y-1 transition-colors",
                                        isWaived
                                            ? "border-emerald-200 bg-emerald-50/40"
                                            : isCustom
                                                ? "border-blue-200 bg-blue-50/40"
                                                : "border-amber-100 bg-amber-50/50"
                                    )}>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className={cn(
                                                    "font-semibold",
                                                    isWaived ? "text-emerald-800" : isCustom ? "text-blue-800" : "text-amber-800"
                                                )}>
                                                    Annual Leave Allowance Deduction
                                                </span>
                                                <BreakdownExplanationDialog title="Annual Leave" log={calculation.explanationLog} typeKeys={["annualLeave"]} />
                                                {isWaived && (
                                                    <Badge className="bg-emerald-600 text-white text-[9px] h-4 px-1">WAIVED BY HR</Badge>
                                                )}
                                                {isCustom && (
                                                    <Badge className="bg-blue-600 text-white text-[9px] h-4 px-1">ADJUSTED BY HR</Badge>
                                                )}
                                            </div>
                                            <Badge variant="outline" className="text-[10px] border-border bg-white">{calculation.daysAnnualLeave} day(s)</Badge>
                                        </div>
                                        <p className="text-muted-foreground font-mono leading-relaxed">
                                            {isWaived ? (
                                                <span>
                                                    <span className="line-through text-muted-foreground/60">Original: - PKR {Math.round(origAmt).toLocaleString()}</span>
                                                    {" "}→{" "}
                                                    <strong className="text-emerald-700">- PKR 0</strong> (Waived)
                                                </span>
                                            ) : isCustom ? (
                                                <span>
                                                    <span className="line-through text-muted-foreground/60">Calculated: - PKR {Math.round(origAmt).toLocaleString()}</span>
                                                    {" "}→{" "}
                                                    <strong className="text-blue-700">- PKR {Math.round(currentAmt).toLocaleString()}</strong> (Custom Override)
                                                </span>
                                            ) : (
                                                <span>
                                                    {calculation.daysAnnualLeave} × Per Day Rate (Configured allowances): <strong className="text-amber-800">- PKR {Math.round(currentAmt).toLocaleString()}</strong>
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                );
                            })()}

                            {calculation.daysUnapprovedLeave > 0 && (() => {
                                const isWaived = !!(attendanceAdjustments.waiveAll || attendanceAdjustments.waiveUnapprovedLeave);
                                const customAmt = attendanceAdjustments.customDeductions?.unapprovedLeave;
                                const isCustom = !isWaived && customAmt !== undefined;
                                const currentAmt = calculation.deductionBreakdownByOccasion?.unapprovedLeave ?? calculation.leaveDeduction;
                                const origAmt = calculation.unadjustedOccasionDeductions?.unapprovedLeave ?? currentAmt;

                                return (
                                    <div className={cn(
                                        "p-3 rounded-lg border space-y-1 transition-colors",
                                        isWaived
                                            ? "border-emerald-200 bg-emerald-50/40"
                                            : isCustom
                                                ? "border-blue-200 bg-blue-50/40"
                                                : "border-violet-100 bg-violet-50/50"
                                    )}>
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-2">
                                                <span className={cn(
                                                    "font-semibold",
                                                    isWaived ? "text-emerald-800" : isCustom ? "text-blue-800" : "text-violet-800"
                                                )}>
                                                    Unpaid / Unapproved Leave
                                                </span>
                                                <BreakdownExplanationDialog title="Unapproved Leave" log={calculation.explanationLog} typeKeys={["unapprovedLeave"]} />
                                                {isWaived && (
                                                    <Badge className="bg-emerald-600 text-white text-[9px] h-4 px-1">WAIVED BY HR</Badge>
                                                )}
                                                {isCustom && (
                                                    <Badge className="bg-blue-600 text-white text-[9px] h-4 px-1">ADJUSTED BY HR</Badge>
                                                )}
                                            </div>
                                            <Badge variant="outline" className="text-[10px] border-border bg-white">{calculation.daysUnapprovedLeave} day(s)</Badge>
                                        </div>
                                        <p className="text-muted-foreground font-mono leading-relaxed">
                                            {isWaived ? (
                                                <span>
                                                    <span className="line-through text-muted-foreground/60">Original: - PKR {Math.round(origAmt).toLocaleString()}</span>
                                                    {" "}→{" "}
                                                    <strong className="text-emerald-700">- PKR 0</strong> (Waived)
                                                </span>
                                            ) : isCustom ? (
                                                <span>
                                                    <span className="line-through text-muted-foreground/60">Calculated: - PKR {Math.round(origAmt).toLocaleString()}</span>
                                                    {" "}→{" "}
                                                    <strong className="text-blue-700">- PKR {Math.round(currentAmt).toLocaleString()}</strong> (Custom Override)
                                                </span>
                                            ) : (
                                                <span>
                                                    {calculation.daysUnapprovedLeave} × Per Day Rate (Configured rules): <strong className="text-violet-800">- PKR {Math.round(currentAmt).toLocaleString()}</strong>
                                                </span>
                                            )}
                                        </p>
                                    </div>
                                );
                            })()}

                            {calculation.daysNotEmployed === 0 &&
                                calculation.daysAbsent === 0 &&
                                calculation.totalUndertimeHours === 0 &&
                                (calculation.deductionBreakdownByOccasion?.specialLeave ?? 0) === 0 &&
                                (calculation.deductionBreakdownByOccasion?.sickLeave ?? 0) === 0 &&
                                (calculation.deductionBreakdownByOccasion?.annualLeave ?? 0) === 0 &&
                                calculation.daysUnapprovedLeave === 0 && (
                                <p className="text-muted-foreground italic py-2 text-center">No attendance deductions this cycle. 🎉</p>
                            )}
                        </div>
                        {(() => {
                            const totalAttendanceDeduction = Math.round(
                                calculation.absentDeduction +
                                calculation.leaveDeduction +
                                calculation.notEmployedDeduction
                            );
                            const isZeroDeduction = totalAttendanceDeduction === 0;

                            return (
                                <div className={cn(
                                    "mt-3 flex items-center justify-between p-2.5 rounded-lg border transition-colors",
                                    isZeroDeduction
                                        ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                                        : "bg-rose-50 border-rose-100 text-rose-800"
                                )}>
                                    <span className="text-xs font-semibold">
                                        Total Attendance & Proration Deduction
                                    </span>
                                    <span className={cn(
                                        "text-sm font-bold font-mono",
                                        isZeroDeduction ? "text-emerald-700" : "text-rose-700"
                                    )}>
                                        - PKR {totalAttendanceDeduction.toLocaleString()}
                                    </span>
                                </div>
                            );
                        })()}
                    </CalcSection>

                    {calculation.totalOvertimeHours > 0 && (
                        <CalcSection step="Step 4" title="Overtime Calculation" color="blue">
                            <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg font-mono text-xs space-y-1 text-blue-900">
                                <p>OT Rate = Per Hour Basic × Multiplier</p>
                                <p className="font-bold">OT Rate = {calculation.calculationMeta.perHourBasic.toFixed(2)} × {calculation.calculationMeta.overtimeMultiplier} = {calculation.calculationMeta.overtimeRatePerHour.toFixed(2)} / hr</p>
                                <Separator className="my-1.5 bg-blue-200" />
                                <p>OT Pay = OT Rate × Total OT Hours</p>
                                <div className="flex items-center">
                                    <p className="font-bold">OT Pay = {calculation.calculationMeta.overtimeRatePerHour.toFixed(2)} × {calculation.totalOvertimeHours} hrs = PKR {Math.round(calculation.overtimeAmount).toLocaleString()}</p>
                                    <BreakdownExplanationDialog title="Overtime" log={calculation.explanationLog} typeKeys={["overtime"]} />
                                </div>
                            </div>
                            {calculation.calculationMeta.overtimeMultiplier !== 1.0 && (
                                <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2">
                                    ⚠ Custom multiplier ({calculation.calculationMeta.overtimeMultiplier}×) applied — standard is 1.0×
                                </p>
                            )}
                        </CalcSection>
                    )}

                    <CalcSection step={calculation.totalOvertimeHours > 0 ? "Step 5" : "Step 4"} title="Gross Salary Build-up" color="emerald">
                        <div className="space-y-1 text-xs font-mono">
                            {Object.entries(calculation.allowanceBreakdown)
                                .filter(([id]) => id !== "nightShift")
                                .map(([id, val]) => {
                                    const label = calculation.allowanceNames?.[id] ?? getAllowanceLabel(id);
                                    return (
                                        <div key={id} className="flex justify-between py-0.5 border-b border-dashed border-border/40">
                                            <span className={`${(val as number) <= 0 ? "text-rose-400 line-through" : "text-muted-foreground"}`}>
                                                + {label}
                                            </span>
                                            <span className={(val as number) <= 0 ? "text-rose-400" : ""}>{Math.round(val as number).toLocaleString()}</span>
                                        </div>
                                    );
                                })}
                            {[
                                { label: "Overtime Pay", val: calculation.overtimeAmount },
                                { label: "Night Shift Allowance", val: calculation.nightShiftAllowanceAmount },
                                { label: "Incentive / Arrears", val: calculation.incentiveAmount },
                                { label: "Bonus", val: calculation.bonusAmount },
                            ].filter(r => r.val > 0).map(({ label, val }) => (
                                <div key={label} className="flex justify-between py-0.5 border-b border-dashed border-border/40">
                                    <span className="text-muted-foreground">+ {label}</span>
                                    <span>{Math.round(val).toLocaleString()}</span>
                                </div>
                            ))}
                        </div>
                        <div className="mt-2 flex items-center justify-between p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg">
                            <span className="text-xs font-bold text-emerald-800">= GROSS SALARY</span>
                            <span className="text-base font-extrabold font-mono text-emerald-700">PKR {Math.round(calculation.grossSalary).toLocaleString()}</span>
                        </div>
                    </CalcSection>

                    <CalcSection step={calculation.totalOvertimeHours > 0 ? "Step 6" : "Step 5"} title="Flat Deductions (from Gross)" color="rose">
                        <div className="space-y-1 text-xs font-mono">
                            {calculation.taxDeduction > 0 && (
                                <div className="flex justify-between py-0.5 border-b border-dashed border-border/40">
                                    <span className="text-muted-foreground">− Income Tax</span>
                                    <span className="text-rose-600">{Math.round(calculation.taxDeduction).toLocaleString()}</span>
                                </div>
                            )}
                            {calculation.advanceDeduction > 0 && (
                                <div className="space-y-1">
                                    <div className="flex justify-between py-0.5 border-b border-dashed border-border/40">
                                        <span className="text-muted-foreground">− Salary Advance Recovery</span>
                                        <span className="text-rose-600">{Math.round(calculation.advanceDeduction).toLocaleString()}</span>
                                    </div>
                                    {calculation.advanceProcessRecords?.map((a: any, i: number) => (
                                        <div key={i} className="flex justify-between pl-4 py-0.5 text-[10px] opacity-70 italic border-l-2 ml-1 border-rose-200">
                                            <span>↳ Inst. {a.installmentNo}/{a.totalInstallments} (Remaining PKR {Math.round(a.remainingBalance).toLocaleString()})</span>
                                            <span>{Math.round(a.installmentAmount).toLocaleString()}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {calculation.manualDeductions.map((d, i) => (
                                <div key={i} className="flex justify-between py-0.5 border-b border-dashed border-border/40">
                                    <span className="text-muted-foreground">− {d.description || "Manual Deduction"}</span>
                                    <span className="text-rose-600">{Math.round(d.amount).toLocaleString()}</span>
                                </div>
                            ))}
                            {calculation.totalDeductions === 0 && (
                                <p className="text-muted-foreground italic py-1">No flat deductions applied.</p>
                            )}
                        </div>
                        {calculation.totalDeductions > 0 && (
                            <div className="mt-2 flex items-center justify-between p-2.5 bg-rose-50 border border-rose-100 rounded-lg">
                                <span className="text-xs font-semibold text-rose-800">Total Flat Deductions</span>
                                <span className="text-sm font-bold font-mono text-rose-700">- PKR {Math.round(calculation.totalDeductions).toLocaleString()}</span>
                            </div>
                        )}
                    </CalcSection>

                    <div className="p-4 bg-primary/5 border-2 border-primary/30 rounded-xl space-y-2">
                        <p className="text-xs font-bold uppercase  text-primary">{calculation.totalOvertimeHours > 0 ? "Step 7" : "Step 6"}: Net Salary</p>
                        <div className="font-mono text-xs text-muted-foreground space-y-0.5">
                            <p>Net = Gross − Flat Deductions</p>
                            <p className="font-semibold text-foreground">
                                Net = {Math.round(calculation.grossSalary).toLocaleString()} − {Math.round(calculation.totalDeductions).toLocaleString()} = <span className="text-primary text-base font-extrabold">PKR {Math.round(calculation.netSalary).toLocaleString()}</span>
                            </p>
                        </div>
                        <p className="text-[10px] text-muted-foreground">Net salary cannot go below PKR 0.</p>
                    </div>
                </TabsContent>
            </Tabs>

            {/* ── Draft Save Footer ───────────────────────────────────────────── */}
            <div className="space-y-4 pt-4 border-t sticky bottom-0 bg-background/95 backdrop-blur-sm pb-4">
                <div className="rounded-xl border bg-muted/20 p-4 space-y-3">
                    <p className="text-[11px] font-black uppercase text-muted-foreground">
                        Draft Payslip Save
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                        Saving this slip only updates the draft payroll record. No wallet is debited here. Finance settlement is selected later when the payroll is marked as paid.
                    </p>

                    <form.Field name="remarks">
                        {(field: any) => (
                            <div className="space-y-1.5">
                                <FieldLabel className="text-[11px] font-black uppercase text-muted-foreground">
                                    Payslip Remarks
                                </FieldLabel>
                                <Textarea
                                    value={field.state.value}
                                    onChange={(e) => field.handleChange(e.target.value)}
                                    onBlur={field.handleBlur}
                                    placeholder="e.g. Feb Salary includes OTL exceptions from 16/01/2026 to 15/02/2026"
                                    className="min-h-[64px] text-xs resize-none"
                                />
                            </div>
                        )}
                    </form.Field>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2.5">
                    <Button variant="outline" className="flex-1" onClick={onSuccess} disabled={saveMutation.isPending}>
                        Cancel
                    </Button>
                    <Button
                        className="flex-1"
                        onClick={() => handleSave()}
                        disabled={saveMutation.isPending || !calculation}
                    >
                    {saveMutation.isPending
                            ? <><Loader2 className="mr-2 size-4 animate-spin" /> Saving…</>
                            : <><Calculator className="mr-2 size-4" /> Save Draft Slip</>}
                    </Button>
                </div>
            </div>

            <AlertDialog open={!!showUnmarkedModal} onOpenChange={(o) => (!o && !saveMutation.isPending) && setShowUnmarkedModal(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="text-red-600 flex items-center gap-2">
                            <AlertCircle className="size-5" />
                            Missing Attendance Data
                        </AlertDialogTitle>
                        <AlertDialogDescription className="text-sm mt-3">
                            You are requesting to save a draft slip, but there are <strong className="text-red-600">{showUnmarkedModal?.count} days</strong> of missing attendance data in the evaluation period.
                            <br/><br/>
                            Generating a slip without reviewing and marking all past days will lead to incorrect salary allocations because the system calculates presence using available records.
                            <br/><br/>
                            Do you still want to proceed and save the draft slip despite missing data?
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={saveMutation.isPending}>Cancel</AlertDialogCancel>
                        <Button
                            className="bg-red-600 hover:bg-red-700 text-white"
                            disabled={saveMutation.isPending}
                            onClick={() => {
                                setIgnorePastUnmarkedDays(true);
                                setShowUnmarkedModal(null);
                                // Queue the next save with skip validation true
                                setTimeout(() => {
                                    handleSave(true);
                                }, 50);
                            }}
                        >
                            {saveMutation.isPending ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
                            Proceed Anyway
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

// ── Helper Components ─────────────────────────────────────────────────────────

function SummaryRow({ label, value, isDeduction, highlight, tooltip }: { label: string; value: number; isDeduction?: boolean; highlight?: boolean; tooltip?: string }) {
    if (value === 0 && !highlight) return null;
    return (
        <TableRow className="hover:bg-transparent border-0 group">
            <TableCell className="py-2 text-muted-foreground">
                <div className="flex items-center gap-1.5">
                    {label}
                    {tooltip && (
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Info className="size-3.5 opacity-0 group-hover:opacity-50 transition-opacity cursor-help" />
                                </TooltipTrigger>
                                <TooltipContent side="right"><p className="text-xs">{tooltip}</p></TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                    )}
                </div>
            </TableCell>
            <TableCell className={`text-right py-2 font-mono ${isDeduction ? "text-rose-600" : ""} ${highlight ? "font-bold text-emerald-600" : ""}`}>
                {isDeduction ? "- " : ""}{Math.round(value).toLocaleString()}
            </TableCell>
        </TableRow>
    );
}

function StatCard({ label, value, className, tooltip }: { label: string; value: number | string; className?: string; tooltip?: string }) {
    const content = (
        <div className={cn("p-4 rounded-lg border text-center transition-all duration-200 hover:shadow-md cursor-default", className || "bg-card")}>
            <p className="text-2xl font-bold tracking-tight">{value}</p>
            <p className="text-[10px] text-muted-foreground uppercase mt-1 font-bold tracking-wider">{label}</p>
        </div>
    );
    if (tooltip) {
        return (
            <TooltipProvider>
                <Tooltip>
                    <TooltipTrigger asChild>{content}</TooltipTrigger>
                    <TooltipContent><p className="text-xs">{tooltip}</p></TooltipContent>
                </Tooltip>
            </TooltipProvider>
        );
    }
    return content;
}

type CalcColor = "blue" | "rose" | "emerald" | "slate";
const calcColorMap: Record<CalcColor, string> = {
    blue: "bg-blue-50 border-blue-200 text-blue-800",
    rose: "bg-rose-50 border-rose-200 text-rose-800",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-800",
    slate: "bg-muted/40 border-border text-muted-foreground",
};

function CalcSection({ step, title, color, children }: { step: string; title: string; color: CalcColor; children: React.ReactNode }) {
    return (
        <div className="border rounded-xl overflow-hidden">
            <div className={cn("px-4 py-2.5 flex items-center gap-2 border-b", calcColorMap[color])}>
                <span className="text-[10px] font-extrabold uppercase  opacity-70">{step}</span>
                <span className="text-xs font-bold">{title}</span>
            </div>
            <div className="p-4 space-y-2 bg-card">{children}</div>
        </div>
    );
}

function CalcRow({ label, formula, result }: { label: string; formula: string; result: string }) {
    return (
        <div className="flex items-start justify-between gap-4 text-xs py-1 border-b border-dashed border-border/40 last:border-0">
            <div>
                <p className="font-medium text-foreground">{label}</p>
                <p className="text-muted-foreground font-mono">{formula}</p>
            </div>
            <p className="font-bold font-mono text-right shrink-0">{result}</p>
        </div>
    );
}
