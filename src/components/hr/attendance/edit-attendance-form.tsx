// import { useEffect, useRef, useState } from "react";
// import { useForm } from "@tanstack/react-form";
// import { Button } from "@/components/ui/button";
// import {
//   Field,
//   FieldLabel,
//   FieldError,
//   FieldGroup,
// } from "@/components/ui/field";
// import { Input } from "@/components/ui/input";
// import {
//   Select,
//   SelectContent,
//   SelectTrigger,
//   SelectValue,
//   SelectItem as SelectOption,
// } from "@/components/ui/select";
// import { Textarea } from "@/components/ui/textarea";
// import { useUpsertAttendance } from "@/hooks/hr/use-upsert-attendance";
// import {
//   Loader2,
//   Clock,
//   StickyNote,
//   Info,
//   AlertCircle,
//   CalendarDays,
//   CheckCircle2,
//   CalendarClock,
//   UserX,
//   Palmtree,
//   Save,
//   Moon,
//   Timer
// } from "lucide-react";
// import { Checkbox } from "@/components/ui/checkbox";
// import { upsertAttendanceSchema } from "@/lib/validators/hr-validators";
// import { Separator } from "@/components/ui/separator";
// import { cn } from "@/lib/utils";
// import { Badge } from "@/components/ui/badge";
// import { ManualPunchTimeline } from "./manual-punch-timeline";
// import type { RecomputeResult } from "@/lib/attendance/recompute";

// // ── Types ──────────────────────────────────────────────────────────────────

// interface AttendanceData {
//   checkIn?: string | null;
//   checkOut?: string | null;
//   overtimeHours?: string | null;
//   dutyHours?: string | null;
//   leaveType?: "sick" | "annual" | "special" | null;
//   status: "present" | "absent" | "leave" | "holiday";
//   isLate?: boolean | null;
//   isNightShift?: boolean | null;
//   isApprovedLeave?: boolean | null;
//   leaveApprovalStatus?: "none" | "pending" | "approved" | "rejected" | null;
//   overtimeStatus?: "pending" | "approved" | "rejected" | null;
//   earlyDepartureStatus?:
//     | "none"
//     | "pending"
//     | "approved"
//     | "rejected"
//     | null;
//   overtimeRemarks?: string | null;
//   entrySource?: "biometric" | "manual" | "qr_terminal" | null;
//   notes?: string | null;
// }

// interface Props {
//   employee: {
//     id: string;
//     firstName: string;
//     lastName: string;
//     standardDutyHours?: number | null;
//     isOrderBooker?: boolean | null;
//     shiftStartTime?: string | null;
//     shiftEndTime?: string | null;
//     shifts?: { start: string; end: string }[] | null;
//   };
//   attendance?: AttendanceData | null;
//   date: string;
//   onSuccess: () => void;
// }

// // ── Helpers ────────────────────────────────────────────────────────────────

// const calculateHours = (
//   in1?: string | null,
//   out1?: string | null,
// ): number | null => {
//   const toMin = (t: string) => {
//     const [h, m] = t.split(":").map(Number);
//     return h * 60 + m;
//   };

//   const getMinsDiff = (
//     startStr?: string | null,
//     endStr?: string | null,
//   ): number => {
//     if (!startStr || !endStr) return 0;
//     const s = toMin(startStr);
//     const e = toMin(endStr);
//     return e >= s ? e - s : 24 * 60 - s + e;
//   };

//   const totalMins = getMinsDiff(in1, out1);
//   return totalMins > 0 ? totalMins / 60 : null;
// };

// const statusConfig = {
//   present: {
//     label: "Present",
//     icon: CheckCircle2,
//     color: "text-emerald-600 dark:text-emerald-500",
//     bg: "bg-emerald-50 dark:bg-emerald-500/10",
//     border: "border-emerald-500/30 dark:border-emerald-500/40",
//   },
//   leave: {
//     label: "On Leave",
//     icon: CalendarClock,
//     color: "text-amber-600 dark:text-amber-500",
//     bg: "bg-amber-50 dark:bg-amber-500/10",
//     border: "border-amber-500/30 dark:border-amber-500/40",
//   },
//   absent: {
//     label: "Absent",
//     icon: UserX,
//     color: "text-rose-600 dark:text-rose-500",
//     bg: "bg-rose-50 dark:bg-rose-500/10",
//     border: "border-rose-500/30 dark:border-rose-500/40",
//   },
//   holiday: {
//     label: "Official Holiday",
//     icon: Palmtree,
//     color: "text-blue-600 dark:text-blue-500",
//     bg: "bg-blue-50 dark:bg-blue-500/10",
//     border: "border-blue-500/30 dark:border-blue-500/40",
//   },
// } as const;

// type EarlyDepartureStatus = "none" | "pending" | "approved" | "rejected";

// function resolveEarlyDepartureStatus(
//   currentStatus: EarlyDepartureStatus | null | undefined,
//   computedStatus: RecomputeResult["earlyDepartureStatus"],
// ): EarlyDepartureStatus {
//   if (computedStatus === "none") return "none";
//   if (currentStatus === "approved" || currentStatus === "rejected") {
//     return currentStatus;
//   }
//   return computedStatus;
// }

// // ── Auto-populate hook ─────────────────────────────────────────────────────

// interface AutoPopulateProps {
//   form: any;
//   standardDutyHours: number;
// }

// const AutoPopulate = ({ form, standardDutyHours }: AutoPopulateProps) => {
//   return (
//     <form.Subscribe
//       selector={(s: any) => [
//         s.values.checkIn,
//         s.values.checkOut,
//         s.values.status,
//       ]}
//     >
//       {([ci1, co1, status]: any[]) => (
//         <AutoPopulateEffect
//           form={form}
//           ci1={ci1}
//           co1={co1}
//           status={status}
//           standardDutyHours={standardDutyHours}
//         />
//       )}
//     </form.Subscribe>
//   );
// };

// const AutoPopulateEffect = ({
//   form,
//   ci1,
//   co1,
//   status,
//   standardDutyHours,
// }: {
//   form: any;
//   ci1: string | null;
//   co1: string | null;
//   status: string;
//   standardDutyHours: number;
// }) => {
//   const isFirstRender = useRef(true);

//   useEffect(() => {
//     if (isFirstRender.current) {
//       isFirstRender.current = false;
//       return;
//     }

//     if (status === "absent" || status === "holiday") {
//       form.setFieldValue("dutyHours", "0");
//       form.setFieldValue("overtimeHours", "0");
//       form.setFieldValue("leaveApprovalStatus", "none");
//       return;
//     }

//     if (status === "leave") {
//       form.setFieldValue("dutyHours", "0");
//       form.setFieldValue("overtimeHours", "0");
//       const currentLeaveStatus = form.getFieldValue("leaveApprovalStatus");
//       if (!currentLeaveStatus || currentLeaveStatus === "none") {
//         form.setFieldValue("leaveApprovalStatus", "pending");
//       }
//       return;
//     }

//     if (status === "present") {
//       return;
//     }

//     form.setFieldValue("leaveApprovalStatus", "none");

//     const std = standardDutyHours || 8;
//     const totalHours = calculateHours(ci1, co1);

//     if (totalHours !== null) {
//       if (totalHours > std) {
//         const overtime = totalHours - std;
//         form.setFieldValue("dutyHours", std.toFixed(2));
//         form.setFieldValue("overtimeHours", overtime.toFixed(2));

//         const currentOTStatus = form.getFieldValue("overtimeStatus");
//         if (!currentOTStatus || currentOTStatus === "rejected") {
//           form.setFieldValue("overtimeStatus", "pending");
//         }
//       } else {
//         form.setFieldValue("dutyHours", totalHours.toFixed(2));
//         form.setFieldValue("overtimeHours", "0");
//         form.setFieldValue("overtimeStatus", null);
//         form.setFieldValue("overtimeRemarks", null);
//       }
//     } else if (status === "present") {
//       if (!form.getFieldValue("dutyHours")) {
//         form.setFieldValue("dutyHours", std.toFixed(2));
//       }
//       if (!form.getFieldValue("overtimeHours")) {
//         form.setFieldValue("overtimeHours", "0");
//       }
//     }
//   }, [ci1, co1, status, standardDutyHours]);

//   return null;
// };

// // ── Form ───────────────────────────────────────────────────────────────────

// export const EditAttendanceForm = ({
//   employee,
//   attendance,
//   date,
//   onSuccess,
// }: Props) => {
//   const mutate = useUpsertAttendance();
//   const std = employee.standardDutyHours || 8;
//   const [presentPunchCount, setPresentPunchCount] = useState<number | null>(
//     null,
//   );
//   const [presentPunchesLoaded, setPresentPunchesLoaded] = useState(
//     employee.isOrderBooker ? true : false,
//   );

//   const form = useForm({
//     defaultValues: {
//       employeeId: employee.id,
//       date: date,
//       status: (attendance?.status || "present") as
//         | "present"
//         | "absent"
//         | "leave"
//         | "holiday",
//       leaveType: (attendance?.leaveType ?? null) as
//         | "sick"
//         | "annual"
//         | "special"
//         | null,
//       checkIn: attendance?.checkIn ?? null,
//       checkOut: attendance?.checkOut ?? null,
//       overtimeHours: attendance?.overtimeHours ?? null,
//       isLate: attendance?.isLate ?? false,
//       isNightShift: attendance?.isNightShift ?? false,
//       isApprovedLeave: attendance?.isApprovedLeave ?? false,
//       overtimeRemarks: attendance?.overtimeRemarks ?? null,
//       overtimeStatus: (attendance?.overtimeStatus ?? "pending") as
//         | "pending"
//         | "approved"
//         | "rejected",
//       earlyDepartureStatus: (attendance?.earlyDepartureStatus ?? "none") as
//         | "none"
//         | "pending"
//         | "approved"
//         | "rejected",
//       entrySource: (attendance?.entrySource ?? "manual") as
//         | "biometric"
//         | "manual"
//         | "qr_terminal",
//       dutyHours: attendance?.dutyHours ?? null,
//       leaveApprovalStatus: attendance?.leaveApprovalStatus ?? "none",
//       notes: attendance?.notes ?? null,
//     },
//     onSubmit: async ({ value }) => {
//       const payload = upsertAttendanceSchema.parse(value);
//       await mutate.mutateAsync(
//         { data: payload },
//         { onSuccess: () => onSuccess() },
//       );
//     },
//   });

//   const handlePunchSummaryChange = (
//     summary: RecomputeResult,
//     punchCount: number,
//     isLoaded: boolean,
//   ) => {
//     setPresentPunchCount(punchCount);
//     setPresentPunchesLoaded(isLoaded);
//     form.setFieldValue("checkIn", summary.checkIn);
//     form.setFieldValue("checkOut", summary.checkOut);
//     form.setFieldValue("dutyHours", summary.dutyHours);
//     form.setFieldValue("isLate", summary.isLate ?? false);
//     form.setFieldValue("isNightShift", summary.isNightShift);
//     form.setFieldValue(
//       "earlyDepartureStatus",
//       resolveEarlyDepartureStatus(
//         form.getFieldValue("earlyDepartureStatus"),
//         summary.earlyDepartureStatus,
//       ),
//     );
//   };

//   return (
//     <form
//       onSubmit={(e) => {
//         e.preventDefault();
//         e.stopPropagation();
//         form.handleSubmit();
//       }}
//       className="space-y-0 py-1"
//     >
//       <AutoPopulate form={form} standardDutyHours={std} />

//       <FieldGroup className="space-y-0">
//         {/* ── Section: Status ─────────────────────────────────────────── */}
//         <SectionBlock icon={CalendarDays} label="Attendance Status">
//           <form.Field name="status">
//             {(field) => (
//               <Field className="space-y-1.5">
//                 <FieldLabel className="sr-only">Status</FieldLabel>
//                 <div className="grid grid-cols-2 gap-3">
//                   {(["present", "leave", "absent", "holiday"] as const).map(
//                     (s) => {
//                       const cfg = statusConfig[s];
//                       const Icon = cfg.icon;
//                       const isSelected = field.state.value === s;
//                       return (
//                         <button
//                           key={s}
//                           type="button"
//                           onClick={() => field.handleChange(s)}
//                           className={cn(
//                             "relative flex flex-col items-center justify-center gap-2.5 rounded-xl p-4 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring border-2",
//                             isSelected
//                               ? `${cfg.bg} ${cfg.border} shadow-sm scale-[1.02]`
//                               : "border-border/40 bg-background hover:bg-muted/50 hover:border-border",
//                           )}
//                         >
//                           <Icon className={cn("size-7 transition-colors", isSelected ? cfg.color : "text-muted-foreground opacity-60")} strokeWidth={isSelected ? 2.5 : 2} />
//                           <span className={cn("text-[13px] font-bold tracking-wide transition-colors", isSelected ? cfg.color : "text-muted-foreground")}>{cfg.label}</span>
//                           {isSelected && (
//                             <div className={cn("absolute top-2.5 right-2.5 size-2 rounded-full animate-in zoom-in duration-300", cfg.color.replace('text', 'bg').split(' ')[0])} />
//                           )}
//                         </button>
//                       );
//                     }
//                   )}
//                 </div>
//                 <FieldError
//                   errors={field.state.meta.errors}
//                   className="text-[11px]"
//                 />
//               </Field>
//             )}
//           </form.Field>

//           <form.Subscribe selector={(s: any) => s.values.status}>
//             {(status: string) =>
//               status === "leave" && (
//                 <div className="mt-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
//                   <form.Field name="leaveType">
//                     {(field) => (
//                       <Field className="space-y-1.5">
//                         <FieldLabel className="text-[13px] font-bold text-foreground/90 tracking-wide">
//                           Leave Type <span className="text-destructive">*</span>
//                         </FieldLabel>
//                         <Select
//                           value={field.state.value || ""}
//                           onValueChange={(v: any) =>
//                             field.handleChange(v || null)
//                           }
//                         >
//                           <SelectTrigger className="h-11 text-[14px] bg-background border-border/60 transition-colors focus:ring-2 focus:ring-primary/20 rounded-lg">
//                             <SelectValue placeholder="Select leave type…" />
//                           </SelectTrigger>
//                           <SelectContent>
//                             <SelectOption value="annual">
//                               Annual Leave
//                             </SelectOption>
//                             <SelectOption value="sick">Sick Leave</SelectOption>
//                             <SelectOption value="special">
//                               Special Leave
//                             </SelectOption>
//                           </SelectContent>
//                         </Select>
//                         <FieldError
//                           errors={field.state.meta.errors}
//                           className="text-[11px]"
//                         />
//                       </Field>
//                     )}
//                   </form.Field>

//                   <form.Field name="isApprovedLeave">
//                     {() => (
//                       <div className="flex items-start gap-3.5 p-4 rounded-xl border border-amber-200/60 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20 shadow-sm">
//                         <div className="p-2 bg-amber-100 dark:bg-amber-900/50 rounded-lg shrink-0">
//                           <Info className="size-5 text-amber-600 dark:text-amber-500" />
//                         </div>
//                         <div className="space-y-1">
//                           <p className="text-[13.5px] font-bold text-amber-800 dark:text-amber-400">
//                             Pending Admin Approval
//                           </p>
//                           <p className="text-[12.5px] text-amber-700/80 dark:text-amber-500/80 leading-relaxed">
//                             This leave request will be routed to an
//                             administrator. Salary deductions and Bradford Factor
//                             updates are finalized upon approval.
//                           </p>
//                         </div>
//                       </div>
//                     )}
//                   </form.Field>
//                 </div>
//               )
//             }
//           </form.Subscribe>
//         </SectionBlock>

//         {/* ── Section: Time Tracking ──────────────────────────────────── */}
//         {!employee.isOrderBooker && (
//           <form.Subscribe selector={(s: any) => s.values.status}>
//             {(status: string) => {
//               const blocked = ["absent", "holiday", "leave"].includes(status);

//               return (
//                 <SectionBlock icon={Clock} label="Shift Timings">
//                   {blocked ? (
//                     <div className="flex items-center gap-3.5 p-4 rounded-xl border border-border/50 bg-muted/40 animate-in fade-in duration-300">
//                       <div className="p-2 bg-background rounded-lg shrink-0 shadow-sm border border-border/40">
//                         <Info className="size-5 text-muted-foreground" />
//                       </div>
//                       <p className="text-[13px] text-muted-foreground font-medium">
//                         Time tracking is disabled for the{" "}
//                         <strong className="text-foreground">
//                           {statusConfig[status as keyof typeof statusConfig]
//                             ?.label || status}
//                         </strong>{" "}
//                         status.
//                       </p>
//                     </div>
//                   ) : (
//                     <div className="space-y-6 animate-in fade-in duration-300">
//                       <ManualPunchTimeline
//                         employeeId={employee.id}
//                         date={date}
//                         shifts={employee.shifts ?? null}
//                         onSummaryChange={handlePunchSummaryChange}
//                       />

//                       <div className="grid grid-cols-1 gap-3 pt-2">
//                         <form.Field name="overtimeHours">
//                           {(field) => (
//                             <Field className="space-y-1.5">
//                               <FieldLabel className="text-[13px] font-bold text-foreground/90 tracking-wide">
//                                 Overtime Hours
//                               </FieldLabel>
//                               <Input
//                                 type="number"
//                                 step="0.5"
//                                 placeholder="0.00"
//                                 value={field.state.value || ""}
//                                 onChange={(e) =>
//                                   field.handleChange(e.target.value || null)
//                                 }
//                                 className="h-11 text-[14px] font-medium transition-colors bg-background border-border/60 focus-visible:ring-2 focus-visible:ring-amber-500/30 rounded-lg [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
//                               />
//                             </Field>
//                           )}
//                         </form.Field>
//                       </div>

//                       <form.Subscribe
//                         selector={(s: any) =>
//                           parseFloat(s.values.overtimeHours || "0") > 0
//                         }
//                       >
//                         {(hasOT: boolean) =>
//                           hasOT && (
//                             <div className="space-y-4 p-5 rounded-xl border border-amber-200/60 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20 shadow-sm animate-in fade-in duration-300">
//                               <div className="flex items-center gap-2.5 pb-2 border-b border-amber-200/40 dark:border-amber-800/40">
//                                 <AlertCircle className="size-5 text-amber-600 dark:text-amber-500 shrink-0" />
//                                 <span className="text-[14px] font-bold text-amber-800 dark:text-amber-400">
//                                   Overtime Approval Required
//                                 </span>
//                               </div>

//                               <form.Field name="overtimeRemarks">
//                                 {(field) => (
//                                   <Field className="space-y-1.5">
//                                     <FieldLabel className="text-[12.5px] font-bold text-amber-900/90 dark:text-amber-300/90">
//                                       Reason{" "}
//                                       <span className="text-destructive">
//                                         *
//                                       </span>
//                                     </FieldLabel>
//                                     <Textarea
//                                       placeholder="Describe why overtime was necessary..."
//                                       className="min-h-[80px] text-[13px] resize-none transition-colors focus-visible:ring-amber-500/30 border-amber-200/60 dark:border-amber-800/60 bg-white dark:bg-background rounded-lg shadow-sm"
//                                       value={field.state.value || ""}
//                                       onChange={(e) =>
//                                         field.handleChange(
//                                           e.target.value || null,
//                                         )
//                                       }
//                                     />
//                                     <FieldError
//                                       errors={field.state.meta.errors}
//                                       className="text-[11px] text-red-600"
//                                     />
//                                   </Field>
//                                 )}
//                               </form.Field>

//                               <form.Field name="overtimeStatus">
//                                 {(field) => (
//                                   <div className="flex items-center justify-between pt-1">
//                                     <div className="text-[12.5px] font-bold text-amber-800/70 dark:text-amber-500/80">
//                                       Approval Status
//                                     </div>
//                                     <OTStatusBadge
//                                       status={field.state.value as any}
//                                     />
//                                   </div>
//                                 )}
//                               </form.Field>
//                               <p className="text-[12px] text-amber-700/80 dark:text-amber-500/70 leading-relaxed font-medium">
//                                 Overtime pay is calculated only for Approved
//                                 records. Status is managed by administrators.
//                               </p>
//                             </div>
//                           )
//                         }
//                       </form.Subscribe>

//                       <Separator className="opacity-50" />

//                       <div className="grid grid-cols-2 gap-3 pt-2">
//                         <form.Field name="isLate">
//                           {(field) => (
//                             <FlagToggle
//                               id="isLateEdit"
//                               checked={!!field.state.value}
//                               onCheckedChange={(c) => field.handleChange(!!c)}
//                               label="Late Arrival"
//                               icon={Timer}
//                               colorClass="border-rose-500/40 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400"
//                             />
//                           )}
//                         </form.Field>

//                         <form.Field name="isNightShift">
//                           {(field) => (
//                             <FlagToggle
//                               id="isNightShiftEdit"
//                               checked={!!field.state.value}
//                               onCheckedChange={(c) => field.handleChange(!!c)}
//                               label="Night Shift"
//                               icon={Moon}
//                               colorClass="border-indigo-500/40 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400"
//                             />
//                           )}
//                         </form.Field>
//                       </div>

//                       <form.Field name="earlyDepartureStatus">
//                         {(field) => (
//                           <Field className="space-y-1.5 mt-2">
//                             <div className="rounded-xl border border-border/60 bg-background p-5 shadow-sm">
//                               <div className="flex items-start gap-4">
//                                 <div className="p-2 bg-muted rounded-lg shrink-0 border border-border/40">
//                                   <Info className="size-5 text-muted-foreground" />
//                                 </div>
//                                 <div className="flex-1 space-y-4">
//                                   <div className="space-y-1">
//                                     <FieldLabel className="text-[14px] font-bold text-foreground/90">
//                                       Early Leave Review
//                                     </FieldLabel>
//                                     <p className="text-[12.5px] leading-relaxed text-muted-foreground font-medium">
//                                       {field.state.value === "none"
//                                         ? "Current punches do not end before the scheduled shift end."
//                                         : "Current punches end before the scheduled shift end. Review how payroll should treat it."}
//                                     </p>
//                                   </div>

//                                   <Select
//                                     value={field.state.value ?? "none"}
//                                     onValueChange={(value: EarlyDepartureStatus) =>
//                                       field.handleChange(value)
//                                     }
//                                   >
//                                     <SelectTrigger className="h-10 bg-background text-[13px] font-medium transition-colors focus:ring-2 focus:ring-primary/20 rounded-lg">
//                                       <SelectValue placeholder="Select early leave status" />
//                                     </SelectTrigger>
//                                     <SelectContent>
//                                       <SelectOption value="none">
//                                         No Early Leave
//                                       </SelectOption>
//                                       <SelectOption value="pending">
//                                         Pending Review
//                                       </SelectOption>
//                                       <SelectOption value="approved">
//                                         Approved
//                                       </SelectOption>
//                                       <SelectOption value="rejected">
//                                         Rejected
//                                       </SelectOption>
//                                     </SelectContent>
//                                   </Select>

//                                   <p className="text-[11.5px] leading-relaxed text-muted-foreground/80">
//                                     Use <strong className="text-foreground">Approved</strong> when
//                                     the early checkout should use the early-leave payroll policy.
//                                     Use <strong className="text-foreground">Rejected</strong> when
//                                     the short shift is valid and should not be treated as early
//                                     leave.
//                                   </p>
//                                 </div>
//                               </div>
//                             </div>
//                             <FieldError
//                               errors={field.state.meta.errors}
//                               className="text-[11px]"
//                             />
//                           </Field>
//                         )}
//                       </form.Field>
//                     </div>
//                   )}
//                 </SectionBlock>
//               );
//             }}
//           </form.Subscribe>
//         )}

//         {/* ── Section: Notes ──────────────────────────────────────────── */}
//         <SectionBlock icon={StickyNote} label="Internal Notes">
//           <form.Field name="notes">
//             {(field) => (
//               <Field>
//                 <FieldLabel className="sr-only">Notes</FieldLabel>
//                 <Textarea
//                   placeholder="Add any specific observations, corrections, or context..."
//                   className="min-h-[100px] text-[13.5px] resize-none bg-background border-border/60 focus-visible:ring-2 focus-visible:ring-primary/20 transition-colors rounded-xl shadow-sm"
//                   value={field.state.value || ""}
//                   onChange={(e) => field.handleChange(e.target.value || null)}
//                 />
//               </Field>
//             )}
//           </form.Field>
//         </SectionBlock>
//       </FieldGroup>

//       {/* ── Submit ──────────────────────────────────────────────────────── */}
//       <div className="pt-8 pb-4">
//         <form.Subscribe
//           selector={(s: any) => ({
//             isSubmitting: s.isSubmitting,
//             status: s.values.status,
//           })}
//         >
//           {({
//             isSubmitting,
//             status,
//           }: {
//             isSubmitting: boolean;
//             status: string;
//           }) => {
//             const requiresPunches =
//               status === "present" && !employee.isOrderBooker;
//             const presentWithoutPunches =
//               requiresPunches &&
//               presentPunchesLoaded &&
//               (presentPunchCount ?? 0) === 0;
//             const waitingForPunches =
//               requiresPunches && !presentPunchesLoaded;

//             return (
//               <div className="flex flex-col gap-3">
//                 <Button
//                   type="submit"
//                   disabled={
//                     isSubmitting || presentWithoutPunches || waitingForPunches
//                   }
//                   className="w-full h-12 text-[14px] font-bold rounded-xl active:scale-[0.98] transition-all duration-200 shadow-lg shadow-primary/20 relative overflow-hidden group"
//                 >
//                   <div className="absolute inset-0 bg-white/20 -translate-y-full group-hover:translate-y-full transition-transform duration-500 ease-in-out" />
//                   {isSubmitting ? (
//                     <>
//                       <Loader2 className="mr-2 size-5 animate-spin" />
//                       Saving Record...
//                     </>
//                   ) : waitingForPunches ? (
//                     "Loading punches..."
//                   ) : presentWithoutPunches ? (
//                     "Add a punch before saving present"
//                   ) : (
//                     <>
//                       <Save className="mr-2 size-4" />
//                       Save Attendance Record
//                     </>
//                   )}
//                 </Button>
//                 {status === "present" && (
//                   <p className="text-center text-[11.5px] font-medium text-muted-foreground/80 mt-1">
//                     Punch changes save immediately. Use this button for notes,
//                     overtime, or status changes.
//                   </p>
//                 )}
//               </div>
//             );
//           }}
//         </form.Subscribe>
//       </div>
//     </form>
//   );
// };

// // ── Sub-components ─────────────────────────────────────────────────────────

// const SectionBlock = ({
//   icon: Icon,
//   label,
//   children,
// }: {
//   icon: any;
//   label: string;
//   children: React.ReactNode;
// }) => (
//   <div className="py-6 px-5 bg-card/40 border border-border/40 rounded-2xl mb-5 shadow-sm backdrop-blur-sm">
//     <div className="flex items-center gap-3 mb-6 pb-3.5 border-b border-border/50">
//       <div className="p-2 bg-primary/10 text-primary rounded-lg">
//         <Icon className="size-4.5" strokeWidth={2.5} />
//       </div>
//       <h3 className="text-[14px] font-bold text-foreground tracking-wide uppercase">
//         {label}
//       </h3>
//     </div>
//     <div className="pl-0">{children}</div>
//   </div>
// );

// const FlagToggle = ({
//   id,
//   checked,
//   onCheckedChange,
//   label,
//   icon: Icon,
//   colorClass,
// }: {
//   id: string;
//   checked: boolean;
//   onCheckedChange: (c: boolean) => void;
//   label: string;
//   icon: any;
//   colorClass?: string;
// }) => (
//   <label
//     htmlFor={id}
//     className={cn(
//       "flex items-center justify-between p-3.5 rounded-xl border-2 cursor-pointer transition-all duration-300 select-none shadow-sm",
//       checked ? colorClass : "border-border/40 bg-background hover:bg-muted/40 text-muted-foreground",
//     )}
//   >
//     <div className="flex items-center gap-3">
//       <div className={cn("p-2 rounded-lg transition-colors", checked ? "bg-background/50 text-current" : "bg-muted text-muted-foreground border border-border/40")}>
//         <Icon className="size-4" strokeWidth={2.5} />
//       </div>
//       <span
//         className={cn(
//           "text-[13px] font-bold tracking-wide transition-colors",
//           !checked && "text-foreground/70",
//         )}
//       >
//         {label}
//       </span>
//     </div>
//     <Checkbox
//       id={id}
//       checked={checked}
//       onCheckedChange={(c) => onCheckedChange(!!c)}
//       className={cn("size-5 rounded-md transition-colors", checked && "border-current")}
//     />
//   </label>
// );

// const OTStatusBadge = ({
//   status,
// }: {
//   status: "pending" | "approved" | "rejected" | null;
// }) => {
//   const config = {
//     pending: {
//       label: "Pending",
//       className:
//         "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-400 dark:border-amber-800/60",
//     },
//     approved: {
//       label: "Approved",
//       className:
//         "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-400 dark:border-emerald-800/60",
//     },
//     rejected: {
//       label: "Rejected",
//       className:
//         "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/40 dark:text-rose-400 dark:border-rose-800/60",
//     },
//   };
//   const c = config[status || "pending"];
//   return (
//     <Badge
//       className={cn("text-[11px] font-bold tracking-wide px-2.5 py-0.5", c.className)}
//       variant="outline"
//     >
//       {c.label}
//     </Badge>
//   );
// };



import { useEffect, useRef, useState } from "react";
import { useForm } from "@tanstack/react-form";
import { ZodError } from "zod";
import {
  buildOvertimeRequestSummary,
  normalizeRequestedOvertimeHours,
  type OvertimeRequestSummary,
} from "@/lib/attendance/overtime-request";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldLabel,
  FieldError,
  FieldGroup,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
  SelectItem as SelectOption,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  useClearOrderBookerManualOverride,
  useUpsertAttendance,
} from "@/hooks/hr/use-upsert-attendance";
import {
  Loader2,
  Clock,
  StickyNote,
  Info,
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  CalendarClock,
  UserX,
  Palmtree,
  Save,
  Moon,
  Timer,
  RotateCcw,
} from "lucide-react";
import { upsertAttendanceSchema } from "@/lib/validators/hr-validators";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ManualPunchTimeline } from "./manual-punch-timeline";
import { OvertimeHoursInput } from "./overtime-hours-input";
import type { RecomputeResult } from "@/lib/attendance/recompute";
import type { AttendanceEntrySource } from "@/lib/attendance/order-booker-day-state";

// ── Types ──────────────────────────────────────────────────────────────────

interface AttendanceData {
  checkIn?: string | null;
  checkOut?: string | null;
  overtimeHours?: string | null;
  dutyHours?: string | null;
  leaveType?: "sick" | "annual" | "special" | null;
  status: "present" | "absent" | "leave" | "holiday";
  isLate?: boolean | null;
  isNightShift?: boolean | null;
  isApprovedLeave?: boolean | null;
  leaveApprovalStatus?: "none" | "pending" | "approved" | "rejected" | null;
  overtimeStatus?: "pending" | "approved" | "rejected" | null;
  earlyDepartureStatus?:
  | "none"
  | "pending"
  | "approved"
  | "rejected"
  | null;
  overtimeRemarks?: string | null;
  entrySource?: AttendanceEntrySource | null;
  notes?: string | null;
}

interface Props {
  employee: {
    id: string;
    firstName: string;
    lastName: string;
    standardDutyHours?: number | null;
    isOrderBooker?: boolean | null;
    shiftStartTime?: string | null;
    shiftEndTime?: string | null;
    shifts?: { start: string; end: string }[] | null;
  };
  attendance?: AttendanceData | null;
  date: string;
  onSuccess: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────

// Order also drives keyboard navigation (arrow keys) in the status
// radiogroup below — keep this in sync with statusConfig's keys.
const STATUS_ORDER = ["present", "leave", "absent", "holiday"] as const;

const statusConfig = {
  present: {
    label: "Present",
    icon: CheckCircle2,
    color: "text-emerald-600 dark:text-emerald-500",
    bg: "bg-emerald-50 dark:bg-emerald-500/10",
    border: "border-emerald-500/30 dark:border-emerald-500/40",
    // Explicit class (not derived at runtime) so Tailwind's JIT scanner
    // can actually see and generate it — see audit notes.
    dot: "bg-emerald-600 dark:bg-emerald-500",
  },
  leave: {
    label: "On Leave",
    icon: CalendarClock,
    color: "text-amber-600 dark:text-amber-500",
    bg: "bg-amber-50 dark:bg-amber-500/10",
    border: "border-amber-500/30 dark:border-amber-500/40",
    dot: "bg-amber-600 dark:bg-amber-500",
  },
  absent: {
    label: "Absent",
    icon: UserX,
    color: "text-rose-600 dark:text-rose-500",
    bg: "bg-rose-50 dark:bg-rose-500/10",
    border: "border-rose-500/30 dark:border-rose-500/40",
    dot: "bg-rose-600 dark:bg-rose-500",
  },
  holiday: {
    label: "Official Holiday",
    icon: Palmtree,
    color: "text-blue-600 dark:text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-500/10",
    border: "border-blue-500/30 dark:border-blue-500/40",
    dot: "bg-blue-600 dark:bg-blue-500",
  },
} as const;

type EarlyDepartureStatus = "none" | "pending" | "approved" | "rejected";

function areShiftViolationsEqual(
  a: RecomputeResult["shiftViolations"],
  b: RecomputeResult["shiftViolations"],
) {
  if (a.length !== b.length) return false;

  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.shiftIndex !== right.shiftIndex ||
      left.late !== right.late ||
      left.earlyDeparture !== right.earlyDeparture ||
      left.expectedIn !== right.expectedIn ||
      left.actualIn !== right.actualIn ||
      left.expectedOut !== right.expectedOut ||
      left.actualOut !== right.actualOut
    ) {
      return false;
    }
  }

  return true;
}

function areSummariesEqual(
  current: RecomputeResult | null,
  next: RecomputeResult,
) {
  if (!current) return false;

  return (
    current.checkIn === next.checkIn &&
    current.checkOut === next.checkOut &&
    current.dutyHours === next.dutyHours &&
    current.isLate === next.isLate &&
    current.isNightShift === next.isNightShift &&
    current.earlyDepartureStatus === next.earlyDepartureStatus &&
    current.openInCount === next.openInCount &&
    areShiftViolationsEqual(current.shiftViolations, next.shiftViolations)
  );
}

function resolveEarlyDepartureStatus(
  currentStatus: EarlyDepartureStatus | null | undefined,
  computedStatus: RecomputeResult["earlyDepartureStatus"],
): EarlyDepartureStatus {
  if (computedStatus === "none") return "none";
  if (currentStatus === "approved" || currentStatus === "rejected") {
    return currentStatus;
  }
  return computedStatus;
}

function formatShiftSummary(
  shifts?: { start: string; end: string }[] | null,
): string | null {
  if (!shifts || shifts.length === 0) return null;

  const usableShifts = shifts
    .filter((shift) => shift.start && shift.end)
    .map((shift) => `${shift.start} - ${shift.end}`);

  return usableShifts.length > 0 ? usableShifts.join(" | ") : null;
}

function formatHours(hours: number) {
  return hours.toFixed(2);
}

type PunchDrivenOvertimeUiState = {
  summary: OvertimeRequestSummary;
  requestedOvertimeHours: number;
  remarksRequired: boolean;
  remarksMissing: boolean;
  inputError: string | null;
};

function buildPunchDrivenOvertimeUiState(args: {
  dutyHours: string | number | null | undefined;
  standardDutyHours: number;
  requestedOvertimeHours: string | number | null | undefined;
  overtimeRemarks: string | null | undefined;
}): PunchDrivenOvertimeUiState {
  const summary = buildOvertimeRequestSummary({
    dutyHours: args.dutyHours,
    standardDutyHours: args.standardDutyHours,
    requestedOvertimeHours: args.requestedOvertimeHours,
  });
  const remarksRequired = summary.requestedOvertimeHours > 0;

  return {
    summary,
    requestedOvertimeHours: summary.requestedOvertimeHours,
    remarksRequired,
    remarksMissing: remarksRequired && !args.overtimeRemarks?.trim(),
    inputError:
      summary.state === "stale"
        ? (summary.warning ?? "Requested OT cannot be more than the suggested OT.")
        : null,
  };
}

// ── Auto-populate hook ─────────────────────────────────────────────────────

interface AutoPopulateProps {
  form: any;
}

const AutoPopulate = ({ form }: AutoPopulateProps) => {
  return (
    <form.Subscribe selector={(s: any) => s.values.status}>
      {(status: string) => <AutoPopulateEffect form={form} status={status} />}
    </form.Subscribe>
  );
};

const AutoPopulateEffect = ({
  form,
  status,
}: {
  form: any;
  status: string;
}) => {
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    if (status === "absent" || status === "holiday") {
      form.setFieldValue("dutyHours", "0");
      form.setFieldValue("overtimeHours", "0");
      form.setFieldValue("overtimeRemarks", null);
      form.setFieldValue("overtimeStatus", "pending");
      form.setFieldValue("leaveApprovalStatus", "none");
      return;
    }

    if (status === "leave") {
      form.setFieldValue("dutyHours", "0");
      form.setFieldValue("overtimeHours", "0");
      form.setFieldValue("overtimeRemarks", null);
      form.setFieldValue("overtimeStatus", "pending");
      const currentLeaveStatus = form.getFieldValue("leaveApprovalStatus");
      if (!currentLeaveStatus || currentLeaveStatus === "none") {
        form.setFieldValue("leaveApprovalStatus", "pending");
      }
      return;
    }

    form.setFieldValue("leaveApprovalStatus", "none");
  }, [form, status]);

  return null;
};

type PunchDrivenOvertimeSyncProps = {
  form: any;
  enabled: boolean;
  presentPunchesLoaded: boolean;
  standardDutyHours: number;
  workedDutyHours: string | null | undefined;
  initialRequestedOvertimeHours: string | null | undefined;
  overtimeAutofilledRef: React.MutableRefObject<boolean>;
  overtimeEditedRef: React.MutableRefObject<boolean>;
};

const PunchDrivenOvertimeSync = ({
  form,
  enabled,
  presentPunchesLoaded,
  standardDutyHours,
  workedDutyHours,
  initialRequestedOvertimeHours,
  overtimeAutofilledRef,
  overtimeEditedRef,
}: PunchDrivenOvertimeSyncProps) => {
  return (
    <form.Subscribe
      selector={(s: any) => ({
        overtimeHours: s.values.overtimeHours,
        overtimeRemarks: s.values.overtimeRemarks,
      })}
    >
      {({
        overtimeHours,
        overtimeRemarks,
      }: {
        overtimeHours: string | null;
        overtimeRemarks: string | null;
      }) => (
        <PunchDrivenOvertimeSyncEffect
          form={form}
          enabled={enabled}
          presentPunchesLoaded={presentPunchesLoaded}
          standardDutyHours={standardDutyHours}
          workedDutyHours={workedDutyHours}
          initialRequestedOvertimeHours={initialRequestedOvertimeHours}
          overtimeHours={overtimeHours}
          overtimeRemarks={overtimeRemarks}
          overtimeAutofilledRef={overtimeAutofilledRef}
          overtimeEditedRef={overtimeEditedRef}
        />
      )}
    </form.Subscribe>
  );
};

type PunchDrivenOvertimeSyncEffectProps = PunchDrivenOvertimeSyncProps & {
  overtimeHours: string | null;
  overtimeRemarks: string | null;
};

const PunchDrivenOvertimeSyncEffect = ({
  form,
  enabled,
  presentPunchesLoaded,
  standardDutyHours,
  workedDutyHours,
  initialRequestedOvertimeHours,
  overtimeHours,
  overtimeRemarks,
  overtimeAutofilledRef,
  overtimeEditedRef,
}: PunchDrivenOvertimeSyncEffectProps) => {
  useEffect(() => {
    const requestedOvertimeHours = normalizeRequestedOvertimeHours(
      overtimeHours,
    );

    if (requestedOvertimeHours <= 0 && overtimeRemarks) {
      form.setFieldValue("overtimeRemarks", null);
    }

    if (
      !enabled ||
      !presentPunchesLoaded ||
      overtimeAutofilledRef.current ||
      overtimeEditedRef.current ||
      normalizeRequestedOvertimeHours(initialRequestedOvertimeHours) > 0
    ) {
      return;
    }

    const summary = buildOvertimeRequestSummary({
      dutyHours: workedDutyHours,
      standardDutyHours,
      requestedOvertimeHours: overtimeHours,
    });

    if (
      summary.suggestedOvertimeHours <= 0 ||
      summary.requestedOvertimeHours > 0
    ) {
      return;
    }

    const autofillValue = formatHours(summary.suggestedOvertimeHours);

    if (form.getFieldValue("overtimeHours") !== autofillValue) {
      form.setFieldValue("overtimeHours", autofillValue);
    }

    overtimeAutofilledRef.current = true;
  }, [
    enabled,
    form,
    initialRequestedOvertimeHours,
    overtimeAutofilledRef,
    overtimeEditedRef,
    overtimeHours,
    overtimeRemarks,
    presentPunchesLoaded,
    standardDutyHours,
    workedDutyHours,
  ]);

  return null;
};

// ── Form ───────────────────────────────────────────────────────────────────

export const EditAttendanceForm = ({
  employee,
  attendance,
  date,
  onSuccess,
}: Props) => {
  const mutate = useUpsertAttendance();
  const clearOverride = useClearOrderBookerManualOverride();
  const std = employee.standardDutyHours || 8;
  const isOrderBooker = Boolean(employee.isOrderBooker);
  const isTripDrivenOrderBookerDay =
    isOrderBooker && attendance?.entrySource === "order_booker_trip";
  const isManualOrderBookerDay =
    isOrderBooker && Boolean(attendance) && !isTripDrivenOrderBookerDay;
  const initialRequestedOvertimeHours = attendance?.overtimeHours ?? null;
  const overtimeAutofilledRef = useRef(false);
  const overtimeEditedRef = useRef(false);
  const [presentPunchCount, setPresentPunchCount] = useState<number | null>(
    null,
  );
  const [presentPunchesLoaded, setPresentPunchesLoaded] = useState(
    employee.isOrderBooker ? true : false,
  );
  const [punchSummary, setPunchSummary] = useState<RecomputeResult | null>(null);
  // Surfaces validation/mutation failures to the user instead of failing
  // silently — see audit note on the original onSubmit.
  const [submitError, setSubmitError] = useState<string | null>(null);
  const shiftSummary = formatShiftSummary(employee.shifts ?? null);

  const form = useForm({
    defaultValues: {
      employeeId: employee.id,
      date: date,
      status: (attendance?.status || "present") as
        | "present"
        | "absent"
        | "leave"
        | "holiday",
      leaveType: (attendance?.leaveType ?? null) as
        | "sick"
        | "annual"
        | "special"
        | null,
      checkIn: attendance?.checkIn ?? null,
      checkOut: attendance?.checkOut ?? null,
      overtimeHours: attendance?.overtimeHours ?? null,
      isLate: attendance?.isLate ?? false,
      isNightShift: attendance?.isNightShift ?? false,
      isApprovedLeave: attendance?.isApprovedLeave ?? false,
      overtimeRemarks: attendance?.overtimeRemarks ?? null,
      overtimeStatus: (attendance?.overtimeStatus ?? "pending") as
        | "pending"
        | "approved"
        | "rejected",
      earlyDepartureStatus: (attendance?.earlyDepartureStatus ?? "none") as
        | "none"
        | "pending"
        | "approved"
        | "rejected",
      entrySource: (attendance?.entrySource ?? "manual") as AttendanceEntrySource,
      dutyHours: attendance?.dutyHours ?? null,
      leaveApprovalStatus: attendance?.leaveApprovalStatus ?? "none",
      notes: attendance?.notes ?? null,
    },
    onSubmit: async ({ value }) => {
      setSubmitError(null);
      try {
        const requestedOvertimeHours = normalizeRequestedOvertimeHours(
          value.overtimeHours,
        );
        const trimmedOvertimeRemarks = value.overtimeRemarks?.trim() || null;
        const isPunchDrivenPresentStaff =
          value.status === "present" && !employee.isOrderBooker;
        const overtimeUiState = buildPunchDrivenOvertimeUiState({
          dutyHours: punchSummary?.dutyHours ?? value.dutyHours,
          standardDutyHours: std,
          requestedOvertimeHours: value.overtimeHours,
          overtimeRemarks: trimmedOvertimeRemarks,
        });

        if (isPunchDrivenPresentStaff && overtimeUiState.inputError) {
          setSubmitError(overtimeUiState.inputError);
          return;
        }

        if (overtimeUiState.remarksMissing) {
          setSubmitError(
            "Overtime reason is required when overtime hours are greater than 0",
          );
          return;
        }

        if (
          isOrderBooker &&
          !isTripDrivenOrderBookerDay &&
          !value.notes?.trim()
        ) {
          setSubmitError(
            "A remark is required when manually resolving an order-booker day.",
          );
          return;
        }

        const payload = upsertAttendanceSchema.parse({
          ...value,
          overtimeHours: formatHours(requestedOvertimeHours),
          overtimeRemarks:
            requestedOvertimeHours > 0 ? trimmedOvertimeRemarks : null,
        });
        await mutate.mutateAsync(
          { data: payload },
          { onSuccess: () => onSuccess() },
        );
      } catch (error) {
        // Validation rules and the mutation itself are unchanged — this
        // only makes failures visible instead of silent.
        if (error instanceof ZodError) {
          setSubmitError(
            error.issues[0]?.message ??
            "Please check the highlighted fields and try again.",
          );
        } else {
          setSubmitError(
            "Couldn't save this attendance record. Please try again.",
          );
        }
      }
    },
  });

  const handlePunchSummaryChange = (
    summary: RecomputeResult,
    punchCount: number,
    isLoaded: boolean,
  ) => {
    const setFormValueIfChanged = (fieldName: string, nextValue: unknown) => {
      const currentValue = form.getFieldValue(fieldName as never);
      if (Object.is(currentValue, nextValue)) return;
      form.setFieldValue(fieldName as never, nextValue as never);
    };

    const nextEarlyDepartureStatus = resolveEarlyDepartureStatus(
      form.getFieldValue("earlyDepartureStatus"),
      summary.earlyDepartureStatus,
    );

    setPunchSummary((current) =>
      areSummariesEqual(current, summary) ? current : summary,
    );
    setPresentPunchCount((current) =>
      current === punchCount ? current : punchCount,
    );
    setPresentPunchesLoaded((current) =>
      current === isLoaded ? current : isLoaded,
    );
    setFormValueIfChanged("checkIn", summary.checkIn);
    setFormValueIfChanged("checkOut", summary.checkOut);
    setFormValueIfChanged("dutyHours", summary.dutyHours);
    setFormValueIfChanged("isLate", summary.isLate ?? false);
    setFormValueIfChanged("isNightShift", summary.isNightShift);
    setFormValueIfChanged(
      "earlyDepartureStatus",
      nextEarlyDepartureStatus,
    );
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        e.stopPropagation();
        form.handleSubmit();
      }}
      className="space-y-0 py-1"
    >
      <AutoPopulate form={form} />
      <PunchDrivenOvertimeSync
        form={form}
        enabled={!isOrderBooker}
        presentPunchesLoaded={presentPunchesLoaded}
        standardDutyHours={std}
        workedDutyHours={punchSummary?.dutyHours ?? attendance?.dutyHours}
        initialRequestedOvertimeHours={initialRequestedOvertimeHours}
        overtimeAutofilledRef={overtimeAutofilledRef}
        overtimeEditedRef={overtimeEditedRef}
      />

      <FieldGroup className="space-y-0">
        {/* ── Section: Status ─────────────────────────────────────────── */}
        <SectionBlock icon={CalendarDays} label="Attendance Status">
          <form.Field name="status">
            {(field) => (
              <Field className="space-y-1.5">
                <FieldLabel className="sr-only">Status</FieldLabel>
                <div
                  role="radiogroup"
                  aria-label="Attendance status"
                  className="grid grid-cols-2 gap-3"
                >
                  {STATUS_ORDER.map((s, index) => {
                    const cfg = statusConfig[s];
                    const Icon = cfg.icon;
                    const isSelected = field.state.value === s;
                    const disabledByTrip =
                      isTripDrivenOrderBookerDay && s !== "present";
                    return (
                      <button
                        key={s}
                        id={`status-option-${s}`}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        aria-disabled={disabledByTrip}
                        tabIndex={isSelected ? 0 : -1}
                        onClick={() => {
                          if (disabledByTrip) return;
                          field.handleChange(s);
                        }}
                        onKeyDown={(e) => {
                          if (disabledByTrip) return;
                          if (
                            ![
                              "ArrowRight",
                              "ArrowDown",
                              "ArrowLeft",
                              "ArrowUp",
                            ].includes(e.key)
                          ) {
                            return;
                          }
                          e.preventDefault();
                          const dir =
                            e.key === "ArrowRight" || e.key === "ArrowDown"
                              ? 1
                              : -1;
                          const nextIndex =
                            (index + dir + STATUS_ORDER.length) %
                            STATUS_ORDER.length;
                          const nextStatus = STATUS_ORDER[nextIndex];
                          field.handleChange(nextStatus);
                          document
                            .getElementById(`status-option-${nextStatus}`)
                            ?.focus();
                        }}
                        className={cn(
                          "relative flex flex-col items-center justify-center gap-2.5 rounded-xl p-4 transition-all duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring border-2",
                          isSelected
                            ? `${cfg.bg} ${cfg.border} shadow-sm scale-[1.02]`
                            : disabledByTrip
                              ? "border-border/30 bg-muted/30 opacity-45 cursor-not-allowed"
                              : "border-border/40 bg-background hover:bg-muted/50 hover:border-border",
                        )}
                      >
                        <Icon
                          aria-hidden="true"
                          className={cn("size-7 transition-colors", isSelected ? cfg.color : "text-muted-foreground opacity-60")}
                          strokeWidth={isSelected ? 2.5 : 2}
                        />
                        <span className={cn("text-[13px] font-bold tracking-wide transition-colors", isSelected ? cfg.color : "text-muted-foreground")}>
                          {cfg.label}
                        </span>
                        {isSelected && (
                          <div
                            aria-hidden="true"
                            className={cn("absolute top-2.5 right-2.5 size-2 rounded-full animate-in zoom-in duration-300", cfg.dot)}
                          />
                        )}
                      </button>
                    );
                  })}
                </div>
                {isTripDrivenOrderBookerDay && (
                  <div className="mt-3 rounded-xl border border-emerald-500/25 bg-emerald-50/70 dark:bg-emerald-500/10 p-3">
                    <p className="text-[12px] font-medium text-emerald-800 dark:text-emerald-300 leading-relaxed">
                      This day has trip records, so it stays Present. Edit or
                      delete the trip first if the trip is wrong.
                    </p>
                  </div>
                )}
                <FieldError
                  errors={field.state.meta.errors}
                  className="text-[11px]"
                />
              </Field>
            )}
          </form.Field>

          <form.Subscribe selector={(s: any) => s.values.status}>
            {(status: string) =>
              status === "leave" && (
                <div className="mt-5 space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  <form.Field name="leaveType">
                    {(field) => (
                      <Field className="space-y-1.5">
                        <FieldLabel className="text-[13px] font-bold text-foreground/90 tracking-wide">
                          Leave Type{" "}
                          <span className="text-destructive" aria-hidden="true">
                            *
                          </span>
                          <span className="sr-only"> (required)</span>
                        </FieldLabel>
                        <Select
                          value={field.state.value || ""}
                          onValueChange={(v: any) =>
                            field.handleChange(v || null)
                          }
                        >
                          <SelectTrigger
                            aria-label="Leave type"
                            className="h-11 text-[14px] bg-background border-border/60 transition-colors focus:ring-2 focus:ring-primary/20 rounded-lg"
                          >
                            <SelectValue placeholder="Select leave type…" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectOption value="annual">
                              Annual Leave
                            </SelectOption>
                            <SelectOption value="sick">Sick Leave</SelectOption>
                            <SelectOption value="special">
                              Special Leave
                            </SelectOption>
                          </SelectContent>
                        </Select>
                        <FieldError
                          errors={field.state.meta.errors}
                          className="text-[11px]"
                        />
                      </Field>
                    )}
                  </form.Field>

                  <form.Field name="isApprovedLeave">
                    {() => (
                      <div className="flex items-start gap-3.5 p-4 rounded-xl border border-amber-200/60 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20 shadow-sm">
                        <div className="p-2 bg-amber-100 dark:bg-amber-900/50 rounded-lg shrink-0">
                          <Info
                            aria-hidden="true"
                            className="size-5 text-amber-600 dark:text-amber-500"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-[13.5px] font-bold text-amber-800 dark:text-amber-400">
                            Pending Admin Approval
                          </p>
                          <p className="text-[12.5px] text-amber-700/80 dark:text-amber-500/80 leading-relaxed">
                            This leave request will be routed to an
                            administrator. Salary deductions and Bradford Factor
                            updates are finalized upon approval.
                          </p>
                        </div>
                      </div>
                    )}
                  </form.Field>
                </div>
              )
            }
          </form.Subscribe>
        </SectionBlock>

        {/* ── Section: Time Tracking ──────────────────────────────────── */}
        {!employee.isOrderBooker && (
          <form.Subscribe selector={(s: any) => s.values.status}>
            {(status: string) => {
              const blocked = ["absent", "holiday", "leave"].includes(status);

              return (
                <SectionBlock icon={Clock} label="Punch Timeline">
                  {blocked ? (
                    <div className="flex items-center gap-3.5 p-4 rounded-xl border border-border/50 bg-muted/40 animate-in fade-in duration-300">
                      <div className="p-2 bg-background rounded-lg shrink-0 shadow-sm border border-border/40">
                        <Info aria-hidden="true" className="size-5 text-muted-foreground" />
                      </div>
                      <p className="text-[13px] text-muted-foreground font-medium">
                        Time tracking is disabled for the{" "}
                        <strong className="text-foreground">
                          {statusConfig[status as keyof typeof statusConfig]
                            ?.label || status}
                        </strong>{" "}
                        status.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-6 animate-in fade-in duration-300">
                      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
                        <p className="text-[13px] font-bold text-foreground">
                          Punches control standard staff attendance
                        </p>
                        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                          Check-in, check-out, duty hours, late arrival, and
                          night shift all come from the punch timeline below.
                          Use Save only for notes, overtime, or early-leave
                          review.
                        </p>
                        {shiftSummary && (
                          <p className="mt-2 text-[11.5px] font-medium text-muted-foreground">
                            Scheduled shift: {shiftSummary}
                          </p>
                        )}
                      </div>

                      {!presentPunchesLoaded && (
                        <div
                          role="status"
                          aria-live="polite"
                          className="flex items-center gap-2.5 text-[12.5px] font-medium text-muted-foreground"
                        >
                          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                          Loading punch records…
                        </div>
                      )}

                      <ManualPunchTimeline
                        employeeId={employee.id}
                        date={date}
                        shifts={employee.shifts ?? null}
                        onSummaryChange={handlePunchSummaryChange}
                      />

                      <form.Subscribe
                        selector={(s: any) => {
                          const overtimeUi = buildPunchDrivenOvertimeUiState({
                            dutyHours: punchSummary?.dutyHours ?? s.values.dutyHours,
                            standardDutyHours: std,
                            requestedOvertimeHours: s.values.overtimeHours,
                            overtimeRemarks: s.values.overtimeRemarks,
                          });

                          return {
                            overtimeStatus: s.values.overtimeStatus,
                            overtimeUi,
                          };
                        }}
                      >
                        {({
                          overtimeStatus,
                          overtimeUi,
                        }: {
                          overtimeStatus: "pending" | "approved" | "rejected";
                          overtimeUi: PunchDrivenOvertimeUiState;
                        }) => (
                          <div className="space-y-4 pt-2">
                            <div className="rounded-xl border border-border/60 bg-background p-4 shadow-sm">
                              <div className="flex items-center gap-2.5 pb-3">
                                <AlertCircle
                                  aria-hidden="true"
                                  className="size-4.5 text-primary"
                                />
                                <div>
                                  <p className="text-[13px] font-bold text-foreground">
                                    Overtime request summary
                                  </p>
                                  <p className="text-[11.5px] text-muted-foreground">
                                    Suggested OT is based on punches and standard duty hours.
                                  </p>
                                </div>
                              </div>

                              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                                <ReadOnlyMetricCard
                                  label="Worked Hours"
                                  value={`${formatHours(overtimeUi.summary.workedDutyHours)}h`}
                                />
                                <ReadOnlyMetricCard
                                  label="Standard Hours"
                                  value={`${formatHours(overtimeUi.summary.standardDutyHours)}h`}
                                />
                                <ReadOnlyMetricCard
                                  label="Suggested OT"
                                  value={`${formatHours(overtimeUi.summary.suggestedOvertimeHours)}h`}
                                  accentClass="border-amber-300/60 bg-amber-50/60 text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-300"
                                />
                              </div>
                            </div>

                            {overtimeUi.summary.state !== "valid" &&
                              overtimeUi.summary.state !== "none" && (
                                <div
                                  role="status"
                                  aria-live="polite"
                                  className={cn(
                                    "flex items-start gap-3 rounded-xl border p-3.5 shadow-sm animate-in fade-in duration-200",
                                    overtimeUi.summary.state === "stale"
                                      ? "border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/40"
                                      : "border-amber-400/40 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/40",
                                  )}
                                >
                                  <AlertCircle
                                    aria-hidden="true"
                                    className={cn(
                                      "mt-0.5 size-4.5 shrink-0",
                                      overtimeUi.summary.state === "stale"
                                        ? "text-rose-600 dark:text-rose-400"
                                        : "text-amber-700 dark:text-amber-400",
                                    )}
                                  />
                                  <div className="space-y-1">
                                    <p
                                      className={cn(
                                        "text-[12.5px] font-semibold leading-relaxed",
                                        overtimeUi.summary.state === "stale"
                                          ? "text-rose-700 dark:text-rose-300"
                                          : "text-amber-800 dark:text-amber-300",
                                      )}
                                    >
                                      {overtimeUi.summary.warning}
                                    </p>
                                    {overtimeUi.summary.state === "stale" && (
                                      <p className="text-[11.5px] text-rose-700/80 dark:text-rose-300/80">
                                        Reduce the requested OT or correct the punches before saving.
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}

                            <div className="grid grid-cols-1 gap-3">
                              <form.Field name="overtimeHours">
                                {(field) => (
                                  <OvertimeHoursInput
                                    value={field.state.value}
                                    onChange={(nextValue) => {
                                      overtimeEditedRef.current = true;
                                      field.handleChange(nextValue);
                                    }}
                                    maxHours={
                                      overtimeUi.summary.suggestedOvertimeHours
                                    }
                                    hint="Requested OT cannot be more than the suggested OT."
                                    inputError={overtimeUi.inputError}
                                    ariaDescribedBy="overtime-hours-hint"
                                    disabled={overtimeStatus === "approved"}
                                  />
                                )}
                              </form.Field>
                            </div>

                            {overtimeUi.remarksRequired && (
                              <div className="space-y-4 p-5 rounded-xl border border-amber-200/60 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20 shadow-sm animate-in fade-in duration-300">
                                <div className="flex items-center gap-2.5 pb-2 border-b border-amber-200/40 dark:border-amber-800/40">
                                  <AlertCircle
                                    aria-hidden="true"
                                    className="size-5 text-amber-600 dark:text-amber-500 shrink-0"
                                  />
                                  <span className="text-[14px] font-bold text-amber-800 dark:text-amber-400">
                                    Overtime Approval Required
                                  </span>
                                </div>

                                <form.Field name="overtimeRemarks">
                                  {(field) => (
                                    <Field className="space-y-1.5">
                                      <FieldLabel className="text-[12.5px] font-bold text-amber-900/90 dark:text-amber-300/90">
                                        Overtime Reason{" "}
                                        <span className="text-destructive" aria-hidden="true">
                                          *
                                        </span>
                                        <span className="sr-only"> (required)</span>
                                      </FieldLabel>
                                      <p className="text-[11.5px] text-amber-800/80 dark:text-amber-300/80">
                                        Explain why extra hours were needed. Admin will review this before approval.
                                      </p>
                                      <Textarea
                                        required
                                        aria-required="true"
                                        placeholder="Describe why overtime was necessary..."
                                        className={cn(
                                          "min-h-[80px] text-[13px] resize-none transition-colors focus-visible:ring-amber-500/30 border-amber-200/60 dark:border-amber-800/60 bg-white dark:bg-background rounded-lg shadow-sm",
                                          overtimeUi.remarksMissing &&
                                            "border-destructive focus-visible:ring-destructive/30",
                                        )}
                                        value={field.state.value || ""}
                                        onChange={(e) =>
                                          field.handleChange(
                                            e.target.value || null,
                                          )
                                        }
                                      />
                                      {overtimeUi.remarksMissing && (
                                        <p className="text-[11px] text-destructive">
                                          Overtime reason is required when overtime hours are greater than 0
                                        </p>
                                      )}
                                    </Field>
                                  )}
                                </form.Field>

                                <div className="flex items-center justify-between pt-1">
                                  <div className="text-[12.5px] font-bold text-amber-800/70 dark:text-amber-500/80">
                                    Current Status
                                  </div>
                                  <OTStatusBadge status={overtimeStatus as any} />
                                </div>
                                <p className="text-[12px] text-amber-700/80 dark:text-amber-500/70 leading-relaxed font-medium">
                                  Saving this request sends it for admin review. Overtime pay is calculated only for Approved records.
                                </p>
                              </div>
                            )}
                          </div>
                        )}
                      </form.Subscribe>

                      <Separator className="opacity-50" />

                      <div className="space-y-3 pt-2">
                        <p className="text-[12px] font-bold uppercase tracking-wide text-muted-foreground">
                          Calculated from punches
                        </p>
                        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                          <form.Field name="isLate">
                            {(field) => (
                              <DerivedFlagCard
                                label="Late Arrival"
                                icon={Timer}
                                active={!!field.state.value}
                                activeText="Marked late from punch timing"
                                inactiveText="On time from punch timing"
                                colorClass="border-rose-500/40 bg-rose-50 dark:bg-rose-500/10 text-rose-700 dark:text-rose-400"
                              />
                            )}
                          </form.Field>

                          <form.Field name="isNightShift">
                            {(field) => (
                              <DerivedFlagCard
                                label="Night Shift"
                                icon={Moon}
                                active={!!field.state.value}
                                activeText="Detected as night-shift work"
                                inactiveText="Handled as day-shift work"
                                colorClass="border-indigo-500/40 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-700 dark:text-indigo-400"
                              />
                            )}
                          </form.Field>
                        </div>
                      </div>

                      <form.Field name="earlyDepartureStatus">
                        {(field) => (
                          <Field className="space-y-1.5 mt-2">
                            <div className="rounded-xl border border-border/60 bg-background p-5 shadow-sm">
                              <div className="flex items-start gap-4">
                                <div className="p-2 bg-muted rounded-lg shrink-0 border border-border/40">
                                  <Info aria-hidden="true" className="size-5 text-muted-foreground" />
                                </div>
                                <div className="flex-1 space-y-4">
                                  <div className="space-y-1">
                                    <FieldLabel className="text-[14px] font-bold text-foreground/90">
                                      Early Leave Review
                                    </FieldLabel>
                                    <p className="text-[12.5px] leading-relaxed text-muted-foreground font-medium">
                                      {(punchSummary?.earlyDepartureStatus ?? "none") === "none"
                                        ? "No early checkout is detected from the current punches."
                                        : "The last OUT punch is earlier than the scheduled shift end. Review how payroll should treat this short day."}
                                    </p>
                                  </div>

                                  <Select
                                    value={field.state.value ?? "none"}
                                    onValueChange={(value: EarlyDepartureStatus) =>
                                      field.handleChange(value)
                                    }
                                  >
                                    <SelectTrigger
                                      aria-label="Early departure status"
                                      disabled={
                                        (punchSummary?.earlyDepartureStatus ?? "none") === "none"
                                      }
                                      className="h-10 bg-background text-[13px] font-medium transition-colors focus:ring-2 focus:ring-primary/20 rounded-lg"
                                    >
                                      <SelectValue placeholder="Select early leave status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      <SelectOption value="none">
                                        No Early Leave
                                      </SelectOption>
                                      <SelectOption value="pending">
                                        Pending Review
                                      </SelectOption>
                                      <SelectOption value="approved">
                                        Approved
                                      </SelectOption>
                                      <SelectOption value="rejected">
                                        Rejected
                                      </SelectOption>
                                    </SelectContent>
                                  </Select>

                                  <p className="text-[11.5px] leading-relaxed text-muted-foreground/80">
                                    Use <strong className="text-foreground">Approved</strong> when
                                    the early checkout should reduce salary under the early-leave
                                    policy. Use <strong className="text-foreground">Rejected</strong>{" "}
                                    when the early-leave policy should not apply. If this stays{" "}
                                    <strong className="text-foreground">Pending</strong> or{" "}
                                    <strong className="text-foreground">Rejected</strong>, payroll
                                    still treats it as a short day and falls back to the normal
                                    short-hours deduction rule.
                                  </p>
                                </div>
                              </div>
                            </div>
                            <FieldError
                              errors={field.state.meta.errors}
                              className="text-[11px]"
                            />
                          </Field>
                        )}
                      </form.Field>
                    </div>
                  )}
                </SectionBlock>
              );
            }}
          </form.Subscribe>
        )}

        {/* ── Section: Notes ──────────────────────────────────────────── */}
        <SectionBlock icon={StickyNote} label="Internal Notes">
          <form.Field name="notes">
            {(field) => (
              <Field>
                <FieldLabel className="sr-only">
                  {isOrderBooker && !isTripDrivenOrderBookerDay
                    ? "Required order-booker remark"
                    : "Notes"}
                </FieldLabel>
                <Textarea
                  placeholder={
                    isOrderBooker && !isTripDrivenOrderBookerDay
                      ? "Required: explain why HR is manually resolving this order-booker day."
                      : "Add any specific observations, corrections, or context..."
                  }
                  className="min-h-[100px] text-[13.5px] resize-none bg-background border-border/60 focus-visible:ring-2 focus-visible:ring-primary/20 transition-colors rounded-xl shadow-sm"
                  value={field.state.value || ""}
                  onChange={(e) => field.handleChange(e.target.value || null)}
                />
                {isOrderBooker && !isTripDrivenOrderBookerDay && (
                  <p className="text-[11.5px] font-medium text-muted-foreground">
                    Required for manual order-booker overrides.
                  </p>
                )}
              </Field>
            )}
          </form.Field>
        </SectionBlock>
      </FieldGroup>

      {/* ── Submit ──────────────────────────────────────────────────────── */}
      <div className="pt-8 pb-4">
        <form.Subscribe
          selector={(s: any) => ({
            isSubmitting: s.isSubmitting,
            status: s.values.status,
            overtimeUi: buildPunchDrivenOvertimeUiState({
              dutyHours: punchSummary?.dutyHours ?? s.values.dutyHours,
              standardDutyHours: std,
              requestedOvertimeHours: s.values.overtimeHours,
              overtimeRemarks: s.values.overtimeRemarks,
            }),
          })}
        >
          {({
            isSubmitting,
            status,
            overtimeUi,
          }: {
            isSubmitting: boolean;
            status: string;
            overtimeUi: PunchDrivenOvertimeUiState;
          }) => {
            const requiresPunches =
              status === "present" && !employee.isOrderBooker;
            const presentWithoutPunches =
              requiresPunches &&
              presentPunchesLoaded &&
              (presentPunchCount ?? 0) === 0;
            const waitingForPunches =
              requiresPunches && !presentPunchesLoaded;
            const staleOvertimeRequest =
              requiresPunches && overtimeUi.summary.state === "stale";

            return (
              <div className="flex flex-col gap-3">
                {submitError && (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="flex items-start gap-3 p-3.5 rounded-xl border border-rose-500/30 bg-rose-50 dark:bg-rose-500/10 dark:border-rose-500/40 animate-in fade-in duration-200"
                  >
                    <AlertCircle
                      aria-hidden="true"
                      className="size-4.5 text-rose-600 dark:text-rose-500 shrink-0 mt-0.5"
                    />
                    <p className="text-[12.5px] font-medium text-rose-700 dark:text-rose-400 leading-relaxed">
                      {submitError}
                    </p>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={
                    isSubmitting ||
                    presentWithoutPunches ||
                    waitingForPunches ||
                    staleOvertimeRequest
                  }
                  className="w-full h-12 text-[14px] font-bold rounded-xl active:scale-[0.98] transition-all duration-200 shadow-lg shadow-primary/20 relative overflow-hidden group"
                >
                  <div className="absolute inset-0 bg-white/20 -translate-y-full group-hover:translate-y-full transition-transform duration-500 ease-in-out" />
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 size-5 animate-spin" aria-hidden="true" />
                      Saving Record...
                    </>
                  ) : waitingForPunches ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                      Loading punches...
                    </>
                  ) : presentWithoutPunches ? (
                    "Add at least one punch to save as Present"
                  ) : staleOvertimeRequest ? (
                    "Fix Requested OT Before Saving"
                  ) : (
                    <>
                      <Save className="mr-2 size-4" aria-hidden="true" />
                      Save Attendance Record
                    </>
                  )}
                </Button>

                {isManualOrderBookerDay && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={clearOverride.isPending || isSubmitting}
                    onClick={async () => {
                      setSubmitError(null);
                      try {
                        await clearOverride.mutateAsync(
                          { data: { employeeId: employee.id, date } },
                          { onSuccess: () => onSuccess() },
                        );
                      } catch (error) {
                        setSubmitError(
                          error instanceof Error
                            ? error.message
                            : "Couldn't clear this manual override.",
                        );
                      }
                    }}
                    className="w-full h-11 rounded-xl font-bold"
                  >
                    {clearOverride.isPending ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" aria-hidden="true" />
                        Returning...
                      </>
                    ) : (
                      <>
                        <RotateCcw className="mr-2 size-4" aria-hidden="true" />
                        Return to Trip-Driven Status
                      </>
                    )}
                  </Button>
                )}

                <div aria-live="polite" className="space-y-1">
                  {presentWithoutPunches && (
                    <p className="text-center text-[11.5px] font-semibold text-rose-600 dark:text-rose-400">
                      Record at least one punch above before saving
                      a Present status.
                    </p>
                  )}
                  {staleOvertimeRequest && (
                    <p className="text-center text-[11.5px] font-semibold text-rose-600 dark:text-rose-400">
                      Requested OT is higher than the latest suggested OT. Lower it before saving.
                    </p>
                  )}
                  {status === "present" && !isOrderBooker && (
                    <p className="text-center text-[11.5px] font-medium text-muted-foreground/80">
                      Punch changes save immediately. Use this button only for
                      notes, overtime, or early-leave review.
                    </p>
                  )}
                  {isOrderBooker && !isTripDrivenOrderBookerDay && (
                    <p className="text-center text-[11.5px] font-medium text-muted-foreground/80">
                      Manual order-booker decisions need a remark and will be
                      used by payroll until returned to trip-driven status.
                    </p>
                  )}
                </div>
              </div>
            );
          }}
        </form.Subscribe>
      </div>
    </form>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────

const SectionBlock = ({
  icon: Icon,
  label,
  children,
}: {
  icon: any;
  label: string;
  children: React.ReactNode;
}) => (
  <div className="py-6 px-5 bg-card/40 border border-border/40 rounded-2xl mb-5 shadow-sm backdrop-blur-sm">
    <div className="flex items-center gap-3 mb-6 pb-3.5 border-b border-border/50">
      <div className="p-2 bg-primary/10 text-primary rounded-lg">
        <Icon aria-hidden="true" className="size-4.5" strokeWidth={2.5} />
      </div>
      <h3 className="text-[14px] font-bold text-foreground tracking-wide uppercase">
        {label}
      </h3>
    </div>
    <div className="pl-0">{children}</div>
  </div>
);

const DerivedFlagCard = ({
  label,
  icon: Icon,
  active,
  activeText,
  inactiveText,
  colorClass,
}: {
  label: string;
  icon: any;
  active: boolean;
  activeText: string;
  inactiveText: string;
  colorClass?: string;
}) => (
  <div
    className={cn(
      "rounded-xl border-2 p-3.5 shadow-sm transition-all duration-300",
      active
        ? colorClass
        : "border-border/40 bg-background text-muted-foreground",
    )}
  >
    <div className="flex items-start gap-3">
      <div className={cn("p-2 rounded-lg transition-colors", active ? "bg-background/50 text-current" : "bg-muted text-muted-foreground border border-border/40")}>
        <Icon aria-hidden="true" className="size-4" strokeWidth={2.5} />
      </div>
      <div className="space-y-1">
        <p
          className={cn(
            "text-[13px] font-bold tracking-wide transition-colors",
            !active && "text-foreground/70",
          )}
        >
          {label}
        </p>
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          {active ? activeText : inactiveText}
        </p>
      </div>
    </div>
    <Badge
      variant="outline"
      className={cn(
        "shrink-0 self-start rounded-full px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wide",
        active
          ? "border-current bg-background/60 text-current"
          : "border-border/60 text-muted-foreground",
      )}
    >
      {active ? "Auto On" : "Auto Off"}
    </Badge>
  </div>
);

const OTStatusBadge = ({
  status,
}: {
  status: "pending" | "approved" | "rejected" | null;
}) => {
  const config = {
    pending: {
      label: "Pending",
      className:
        "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/40 dark:text-amber-400 dark:border-amber-800/60",
    },
    approved: {
      label: "Approved",
      className:
        "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-400 dark:border-emerald-800/60",
    },
    rejected: {
      label: "Rejected",
      className:
        "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-900/40 dark:text-rose-400 dark:border-rose-800/60",
    },
  };
  const c = config[status || "pending"];
  return (
    <Badge
      className={cn("text-[11px] font-bold tracking-wide px-2.5 py-0.5", c.className)}
      variant="outline"
    >
      {c.label}
    </Badge>
  );
};

const ReadOnlyMetricCard = ({
  label,
  value,
  accentClass,
}: {
  label: string;
  value: string;
  accentClass?: string;
}) => (
  <div
    className={cn(
      "rounded-xl border border-border/60 bg-muted/20 px-3.5 py-3 shadow-sm",
      accentClass,
    )}
  >
    <p className="text-[10.5px] font-black uppercase tracking-[0.16em] text-muted-foreground">
      {label}
    </p>
    <p className="mt-1 text-[20px] font-black tracking-tight text-foreground">
      {value}
    </p>
  </div>
);
