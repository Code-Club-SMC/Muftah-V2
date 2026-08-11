import { useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/custom/date-picker";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import {
  Phone,
  UserCheck,
  MessageSquare,
  FileText,
  MoreHorizontal,
  AlertTriangle,
  ChevronUp,
  ChevronDown,
  Edit3,
  Activity,
  Send,
  Check,
  Info,
  SlidersHorizontal,
  User as UserIcon,
  Calendar as CalendarIcon,
} from "lucide-react";
import {
  useGetRecoveryAttempts,
  useAssignRecoveryPerson,
  useUpdateRecoveryStatus,
  useCreateRecoveryAttempt,
  useEscalateRecovery,
  useDeEscalateRecovery,
  useEscalationLabels,
  useUpdateEscalationLabels,
} from "@/hooks/sales/use-credit-recovery";
import { useGetSalesmen } from "@/hooks/sales/use-sales-people";
import { EscalationDialog } from "./escalation-dialog";
import { EscalationLabelsEditor } from "./escalation-labels-editor";
import { AttemptTimeline } from "./attempt-timeline";

type Slip = {
  id: string;
  slipNumber: string;
  outstandingAmount: string;
  recoveryStatus: string | null;
  recoveryAssignedToId: string | null;
  recoveryAssignedTo?: { name: string } | null;
  escalationLevel: number | null;
  nextFollowUpDate?: string | null;
  customer?: {
    name: string;
    customerType?: string;
    city?: string;
    mobileNumber?: string;
  } | null;
  salesman?: { name: string } | null;
  invoice?: { paymentDueDate?: string | null } | null;
};

type Props = {
  slip: Slip | null;
  onClose: () => void;
};

const PKR = (v: number) =>
  `PKR ${v.toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;

const STATUS_STYLES: Record<
  string,
  { label: string; classes: string; dot: string }
> = {
  pending: {
    label: "Pending",
    classes:
      "bg-amber-50 text-amber-700 border-amber-300 dark:bg-amber-950/30 dark:text-amber-400",
    dot: "bg-amber-500",
  },
  in_progress: {
    label: "In Progress",
    classes:
      "bg-blue-50 text-blue-700 border-blue-300 dark:bg-blue-950/30 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  partially_paid: {
    label: "Partially Paid",
    classes:
      "bg-orange-50 text-orange-700 border-orange-300 dark:bg-orange-950/30 dark:text-orange-400",
    dot: "bg-orange-500",
  },
  overdue: {
    label: "Overdue",
    classes:
      "bg-red-50 text-red-700 border-red-300 dark:bg-red-950/30 dark:text-red-400",
    dot: "bg-red-500",
  },
  defaulted: {
    label: "Defaulted",
    classes:
      "bg-red-100 text-red-800 border-red-400 dark:bg-red-950/40 dark:text-red-300",
    dot: "bg-red-600",
  },
};

const METHOD_BUTTONS = [
  { value: "call", icon: Phone, label: "Call" },
  { value: "visit", icon: UserCheck, label: "Visit" },
  { value: "whatsapp", icon: MessageSquare, label: "WhatsApp" },
  { value: "letter", icon: FileText, label: "Letter" },
  { value: "other", icon: MoreHorizontal, label: "Other" },
] as const;

const OUTCOME_OPTIONS = [
  { value: "no_answer", label: "No Answer" },
  { value: "promised", label: "Promised" },
  { value: "partial_payment", label: "Partial Payment" },
  { value: "refused", label: "Refused" },
  { value: "unreachable", label: "Unreachable" },
  { value: "resolved", label: "Resolved" },
];

export function RecoveryDetailSheet({ slip, onClose }: Props) {
  const open = !!slip;
  const slipId = slip?.id ?? "";

  const { data: attempts, isLoading: attemptsLoading } =
    useGetRecoveryAttempts(slipId);
  const { data: salesmen } = useGetSalesmen();
  const { data: labelData } = useEscalationLabels();
  const labels = labelData?.labels;

  const { mutate: assignPerson, isPending: assigning } =
    useAssignRecoveryPerson();
  const { mutate: updateStatus, isPending: updatingStatus } =
    useUpdateRecoveryStatus();
  const { mutate: createAttempt, isPending: creatingAttempt } =
    useCreateRecoveryAttempt();
  const { mutate: escalate, isPending: escalating } = useEscalateRecovery();
  const { mutate: deEscalate, isPending: deEscalating } =
    useDeEscalateRecovery();
  const { mutate: updateLabels, isPending: updatingLabels } =
    useUpdateEscalationLabels();

  const [newAttempt, setNewAttempt] = useState({
    attemptMethod: "call" as string,
    attemptOutcome: "no_answer" as string,
    amountPromised: "" as string,
    promisedDate: "" as string,
    notes: "" as string,
  });
  const [escalationDir, setEscalationDir] = useState<
    "escalate" | "deEscalate" | null
  >(null);
  const [labelsEditorOpen, setLabelsEditorOpen] = useState(false);
  const [attemptsExpanded, setAttemptsExpanded] = useState(true);

  const currentLevel = slip?.escalationLevel ?? 0;
  const labelsByLevel: Record<number, string> = labels
    ? Object.fromEntries(
        Object.entries(labels).map(([k, v]) => [Number(k), v as string]),
      )
    : {};
  const currentLabel = labelsByLevel[currentLevel] ?? `Level ${currentLevel}`;
  const statusMeta = slip?.recoveryStatus
    ? STATUS_STYLES[slip.recoveryStatus]
    : null;
  const needsRecordedAmount =
    newAttempt.attemptOutcome === "promised" ||
    newAttempt.attemptOutcome === "partial_payment";
  const needsPromiseDate = newAttempt.attemptOutcome === "promised";
  const amountFieldLabel =
    newAttempt.attemptOutcome === "partial_payment"
      ? "Recorded Amount"
      : "Promised Amount";

  const handleAssign = (salesmanId: string) => {
    if (!slip) return;
    if (salesmanId === "__unassign__") {
      assignPerson({ slipId: slip.id, recoveryAssignedToId: undefined });
    } else {
      assignPerson({ slipId: slip.id, recoveryAssignedToId: salesmanId });
    }
  };

  const handleStatusChange = (status: string) => {
    if (!slip) return;
    updateStatus({ slipId: slip.id, recoveryStatus: status });
  };

  const handleConfirmEscalation = (reason: string) => {
    if (!slip) return;
    escalate(
      { slipId: slip.id, reason },
      {
        onSuccess: () => {
          setEscalationDir(null);
        },
      },
    );
  };

  const handleConfirmDeEscalation = (reason: string) => {
    if (!slip) return;
    deEscalate(
      { slipId: slip.id, reason },
      {
        onSuccess: () => {
          setEscalationDir(null);
        },
      },
    );
  };

  const handleLogAttempt = () => {
    if (!slip) return;
    if (!newAttempt.attemptOutcome) {
      toast.error("Please select an outcome");
      return;
    }
    createAttempt(
      {
        slipId: slip.id,
        assignedToId: slip.recoveryAssignedToId ?? undefined,
        attemptMethod: newAttempt.attemptMethod,
        attemptOutcome: newAttempt.attemptOutcome,
        amountPromised: newAttempt.amountPromised
          ? Number(newAttempt.amountPromised)
          : undefined,
        promisedDate: newAttempt.promisedDate || undefined,
        notes: newAttempt.notes || undefined,
      },
      {
        onSuccess: () => {
          setNewAttempt({
            attemptMethod: "call",
            attemptOutcome: "no_answer",
            amountPromised: "",
            promisedDate: "",
            notes: "",
          });
        },
      },
    );
  };

  const headerSubtitle = slip
    ? [slip.customer?.name, slip.customer?.city, slip.customer?.mobileNumber]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <>
      <ResponsiveSheet
        open={open}
        onOpenChange={(o) => !o && onClose()}
        title={slip?.slipNumber ?? ""}
        description={headerSubtitle || "Recovery details"}
        icon={FileText}
        className="space-y-4 pb-6"
      >
        {/* Summary band */}
        <div className="border border-border rounded-xl p-4 bg-card">
          <div className="flex items-center gap-4 flex-wrap sm:flex-nowrap">
            <div className="shrink-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                Outstanding Amount
              </p>
              <p className="text-xl font-bold text-red-600 tabular-nums">
                {PKR(Number(slip?.outstandingAmount ?? 0))}
              </p>
            </div>
            <div className="w-px h-10 bg-border hidden sm:block" />
            <div className="shrink-0">
              <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1">
                Due Date
              </p>
              <div className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
                <CalendarIcon className="size-3.5 text-muted-foreground" />
                {slip?.invoice?.paymentDueDate
                  ? format(new Date(slip.invoice.paymentDueDate), "dd MMM yyyy")
                  : "—"}
              </div>
            </div>
            <div className="flex-1 hidden sm:block" />
            <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap ml-auto sm:ml-0">
              {statusMeta && (
                <Badge
                  variant="outline"
                  className={cn(
                    "px-2.5 py-0.5 text-[11px] font-semibold rounded-md whitespace-nowrap",
                    statusMeta.classes,
                  )}
                >
                  {statusMeta.label}
                </Badge>
              )}
              <Badge
                variant="outline"
                className="px-2.5 py-0.5 text-[11px] font-semibold rounded-md whitespace-nowrap bg-violet-50 text-violet-700 border-violet-300 dark:bg-violet-950/30 dark:text-violet-400"
              >
                # L{currentLevel} · {currentLabel}
              </Badge>
            </div>
          </div>
        </div>

        {/* Recovery Management */}
        <section className="border border-border rounded-xl p-4 bg-card">
          <SectionHeading
            icon={SlidersHorizontal}
            title="RECOVERY MANAGEMENT"
            description="Status and assigned recovery person"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Recovery Status</Label>
              <Select
                value={slip?.recoveryStatus ?? undefined}
                onValueChange={handleStatusChange}
                disabled={updatingStatus}
              >
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  {(
                    Object.keys(STATUS_STYLES) as Array<
                      keyof typeof STATUS_STYLES
                    >
                  ).map((key) => {
                    const s = STATUS_STYLES[key];
                    return (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center gap-2">
                          <span
                            className={cn(
                              "size-2 rounded-full shrink-0",
                              s.dot,
                            )}
                          />
                          {s.label}
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Assigned To</Label>
              <Select
                value={slip?.recoveryAssignedToId ?? "__unassign__"}
                onValueChange={handleAssign}
                disabled={assigning}
              >
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassign__">
                    <span className="flex items-center gap-2">
                      <UserIcon className="size-3.5 text-muted-foreground" />
                      Unassigned
                    </span>
                  </SelectItem>
                  {salesmen?.map((s: { id: string; name: string }) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </section>

        {/* Escalation */}
        <section className="border border-border rounded-xl p-4 bg-card">
          <SectionHeading
            icon={AlertTriangle}
            title="ESCALATION"
            description={`Currently at ${currentLabel}`}
            action={
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs font-semibold"
                onClick={() => setLabelsEditorOpen(true)}
              >
                <Edit3 className="size-3.5 mr-1.5" />
                Edit labels
              </Button>
            }
          />
          <div className="mt-5">
            <EscalationLadderInline
              currentLevel={currentLevel}
              labels={labelsByLevel}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 mt-5">
            <Button
              variant="outline"
              onClick={() => setEscalationDir("deEscalate")}
              disabled={currentLevel <= 0 || deEscalating || escalating}
              className="h-11 font-semibold text-blue-600 border-blue-200 hover:bg-blue-50 dark:border-blue-900/50 dark:text-blue-400 dark:hover:bg-blue-950/30"
            >
              <ChevronDown className="size-4 mr-1.5" />
              De-escalate
            </Button>
            <Button
              variant="outline"
              onClick={() => setEscalationDir("escalate")}
              disabled={currentLevel >= 3 || deEscalating || escalating}
              className="h-11 font-semibold text-orange-600 border-orange-200 hover:bg-orange-50 dark:border-orange-900/50 dark:text-orange-400 dark:hover:bg-orange-950/30"
            >
              <ChevronUp className="size-4 mr-1.5" />
              Escalate
            </Button>
          </div>
        </section>

        {/* Attempt History */}
        <section className="border border-border rounded-xl bg-card overflow-hidden">
          <button
            type="button"
            onClick={() => setAttemptsExpanded((v) => !v)}
            className="w-full p-4 flex items-center gap-3 text-left hover:bg-muted/30 transition-colors"
          >
            <SectionHeading
              icon={Activity}
              title="ATTEMPT HISTORY"
              description={
                attempts?.length
                  ? `${attempts.length} attempt${attempts.length === 1 ? "" : "s"} on record`
                  : "No attempts yet"
              }
              hideAction
            />
            <ChevronUp
              className={cn(
                "size-4 text-muted-foreground shrink-0 transition-transform ml-auto",
                !attemptsExpanded && "rotate-180",
              )}
            />
          </button>
          {attemptsExpanded && (
            <div className="px-4 pb-4">
              {attemptsLoading ? (
                <div className="space-y-2">
                  {[...Array(2)].map((_, i) => (
                    <Skeleton key={i} className="h-16 w-full rounded-lg" />
                  ))}
                </div>
              ) : attempts && attempts.length > 0 ? (
                <AttemptTimeline attempts={attempts} />
              ) : (
                <div className="text-center py-6 text-sm text-muted-foreground border border-dashed rounded-lg">
                  No attempts recorded yet
                </div>
              )}
            </div>
          )}
        </section>

        {/* Log New Attempt */}
        <section className="border border-border rounded-xl p-4 bg-card">
          <SectionHeading
            icon={Send}
            title="LOG NEW ATTEMPT"
            description="Record a fresh contact attempt"
            hideAction
          />
          <div className="space-y-5 mt-5">
            <div>
              <Label className="text-sm font-semibold">Method</Label>
              <div className="grid grid-cols-5 gap-2 mt-2">
                {METHOD_BUTTONS.map(({ value, icon: Icon, label }) => {
                  const selected = newAttempt.attemptMethod === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={selected}
                      onClick={() =>
                        setNewAttempt((n) => ({ ...n, attemptMethod: value }))
                      }
                      className={cn(
                        "relative flex flex-col items-center justify-center gap-1.5 py-3 rounded-lg border-2 text-xs font-medium transition-all",
                        selected
                          ? "border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-950/30 dark:text-violet-300 dark:border-violet-500"
                          : "border-border bg-background text-muted-foreground hover:border-violet-300 hover:text-foreground",
                      )}
                    >
                      {selected && (
                        <span className="absolute top-1.5 right-1.5 flex items-center justify-center size-4 rounded-full bg-violet-600 text-white">
                          <Check className="size-2.5" strokeWidth={3} />
                        </span>
                      )}
                      <Icon className="size-4" />
                      <span>{label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <Label className="text-sm font-semibold">Outcome</Label>
              <Select
                value={newAttempt.attemptOutcome}
                onValueChange={(v) =>
                  setNewAttempt((n) => ({
                    ...n,
                    attemptOutcome: v,
                    amountPromised:
                      v === "promised" || v === "partial_payment"
                        ? n.amountPromised
                        : "",
                    promisedDate: v === "promised" ? n.promisedDate : "",
                  }))
                }
              >
                <SelectTrigger className="h-11 w-full mt-2">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTCOME_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {needsRecordedAmount && (
              <div
                className={cn(
                  "grid gap-3",
                  needsPromiseDate
                    ? "grid-cols-1 sm:grid-cols-2"
                    : "grid-cols-1",
                )}
              >
                <div className="space-y-2">
                  <Label className="text-sm font-semibold">
                    {amountFieldLabel}
                  </Label>
                  <Input
                    type="number"
                    placeholder="PKR"
                    className="h-11"
                    value={newAttempt.amountPromised}
                    onChange={(e) =>
                      setNewAttempt((n) => ({
                        ...n,
                        amountPromised: e.target.value,
                      }))
                    }
                  />
                  {newAttempt.attemptOutcome === "partial_payment" && (
                    <p className="text-xs text-muted-foreground">
                      For recovery notes only. Actual payment entry belongs in
                      Reconciliation &gt; Recovery Slip.
                    </p>
                  )}
                </div>
                {needsPromiseDate && (
                  <div className="space-y-2">
                    <Label className="text-sm font-semibold">
                      Promise Date
                    </Label>
                    <DatePicker
                      date={
                        newAttempt.promisedDate
                          ? new Date(newAttempt.promisedDate)
                          : undefined
                      }
                      onChange={(date) => {
                        if (!date) {
                          setNewAttempt((n) => ({ ...n, promisedDate: "" }));
                          return;
                        }
                        const year = date.getFullYear();
                        const month = String(date.getMonth() + 1).padStart(
                          2,
                          "0",
                        );
                        const day = String(date.getDate()).padStart(2, "0");
                        setNewAttempt((n) => ({
                          ...n,
                          promisedDate: `${year}-${month}-${day}`,
                        }));
                      }}
                      placeholder="Select promise date"
                      className="w-full"
                    />
                  </div>
                )}
              </div>
            )}

            <div>
              <Label className="text-sm font-semibold">Notes</Label>
              <Textarea
                placeholder="What was discussed or observed?"
                className="mt-2 text-sm min-h-[88px] resize-none"
                value={newAttempt.notes}
                onChange={(e) =>
                  setNewAttempt((n) => ({ ...n, notes: e.target.value }))
                }
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Add details to keep your team informed and follow up
                effectively.
              </p>
            </div>

            <Button
              className="w-full h-11 bg-violet-600 hover:bg-violet-700 text-white font-semibold"
              onClick={handleLogAttempt}
              disabled={creatingAttempt}
            >
              <Send className="size-4 mr-2" />
              {creatingAttempt ? "Logging..." : "Log Attempt"}
            </Button>
          </div>
        </section>

        {/* Footer info */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground pt-1">
          <Info className="size-3.5 shrink-0" />
          <span>Keep attempts updated to improve recovery success.</span>
        </div>
      </ResponsiveSheet>

      <EscalationDialog
        open={!!escalationDir}
        onOpenChange={(o) => !o && setEscalationDir(null)}
        direction={escalationDir}
        currentLevel={currentLevel}
        labels={labelsByLevel}
        onConfirm={(reason) =>
          escalationDir === "escalate"
            ? handleConfirmEscalation(reason)
            : handleConfirmDeEscalation(reason)
        }
        isPending={escalating || deEscalating}
      />

      <EscalationLabelsEditor
        open={labelsEditorOpen}
        onOpenChange={setLabelsEditorOpen}
        current={labelsByLevel}
        onSave={(newLabels) => {
          updateLabels(
            { labels: newLabels },
            {
              onSuccess: () => setLabelsEditorOpen(false),
            },
          );
        }}
        isPending={updatingLabels}
      />
    </>
  );
}

// ── Sub-components ──

function SectionHeading({
  icon: Icon,
  title,
  description,
  action,
  hideAction = false,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
  hideAction?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 w-full">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center justify-center size-9 rounded-lg bg-violet-100 dark:bg-violet-950/40 shrink-0">
          <Icon className="size-4 text-violet-600 dark:text-violet-400" />
        </div>
        <div className="min-w-0">
          <h3 className="text-xs font-bold uppercase tracking-wide text-foreground leading-tight">
            {title}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        </div>
      </div>
      {!hideAction && action}
    </div>
  );
}

function EscalationLadderInline({
  currentLevel,
  labels,
}: {
  currentLevel: number;
  labels: Record<number, string>;
}) {
  const levels = [0, 1, 2, 3] as const;
  const colorFor = (level: (typeof levels)[number]) => {
    switch (level) {
      case 0:
        return {
          active: "bg-violet-600 text-white border-violet-600",
          idle: "border-violet-300 text-violet-600",
          line: "bg-violet-500",
        };
      case 1:
        return {
          active: "bg-amber-500 text-white border-amber-500",
          idle: "border-amber-400 text-amber-600",
          line: "bg-amber-400",
        };
      case 2:
        return {
          active: "bg-orange-500 text-white border-orange-500",
          idle: "border-orange-400 text-orange-600",
          line: "bg-orange-400",
        };
      case 3:
        return {
          active: "bg-red-500 text-white border-red-500",
          idle: "border-red-400 text-red-600",
          line: "bg-red-400",
        };
    }
  };

  return (
    <div className="relative flex items-start justify-between">
      {levels.map((level, idx) => {
        const colors = colorFor(level);
        const isCurrent = level === currentLevel;
        const isPast = level < currentLevel;
        return (
          <div
            key={level}
            className="flex-1 flex flex-col items-center relative min-w-0"
          >
            {idx > 0 && (
              <div
                className={cn(
                  "absolute top-5 -left-1/2 w-full h-0.5 -translate-y-1/2",
                  isPast || isCurrent
                    ? colors.line
                    : "bg-slate-200 dark:bg-slate-800",
                )}
              />
            )}
            <div
              className={cn(
                "relative z-10 flex items-center justify-center size-10 rounded-full border-2 text-sm font-bold transition-all",
                isCurrent
                  ? colors.active
                  : isPast
                    ? `${colors.active} opacity-60`
                    : `${colors.idle} bg-background`,
              )}
            >
              L{level}
            </div>
            <p
              className={cn(
                "text-[11px] mt-2 text-center font-medium",
                isCurrent
                  ? "text-foreground font-semibold"
                  : isPast
                    ? "text-muted-foreground"
                    : "text-muted-foreground/60",
              )}
            >
              {labels[level] ?? `Level ${level}`}
            </p>
          </div>
        );
      })}
    </div>
  );
}
