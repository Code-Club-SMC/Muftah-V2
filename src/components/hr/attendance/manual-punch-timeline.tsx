import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  Check,
  Clock3,
  Pencil,
  Plus,
  ScanLine,
  Trash2,
  UserRound,
} from "lucide-react";
import { computeAttendanceFromPunches, type RecomputeResult } from "@/lib/attendance/recompute";
import { getProtectedDeletePunchIds } from "@/lib/attendance/punch-sequence";
import { toPKTDate, toPKTTime } from "@/lib/attendance/time";
import {
  useAddManualPunch,
  useCorrectPunch,
  useDeletePunch,
  useEmployeePunches,
} from "@/hooks/hr/use-attendance-punches";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type PunchDirection = "in" | "out";

type PunchRow = {
  id: string;
  timestamp: string | Date;
  attendanceDate: string;
  direction: PunchDirection;
  source: "qr_terminal" | "manual" | "offline_excel";
  note?: string | null;
  terminalUser?: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
};

type ManualPunchTimelineProps = {
  employeeId: string;
  date: string;
  shifts?: { start: string; end: string }[] | null;
  onSummaryChange?: (
    summary: RecomputeResult,
    punchCount: number,
    isLoaded: boolean,
  ) => void;
};

const DEFAULT_GRACE_MINUTES = 15;
const NIGHT_SHIFT_START_HOUR = 20;

function toDateTimeInputValue(value: string | Date) {
  const date = new Date(value);
  const pktDate = new Date(date.getTime() + 5 * 60 * 60 * 1000);
  return pktDate.toISOString().slice(0, 16);
}

function toPKTOffsetTimestamp(value: string) {
  const [datePart, timePart = "00:00"] = value.split("T");
  const normalizedTime =
    timePart.length === 5 ? `${timePart}:00` : timePart.slice(0, 8);
  return `${datePart}T${normalizedTime}+05:00`;
}

function defaultPunchDateTime(date: string) {
  const now = new Date();
  const pktNow = new Date(now.getTime() + 5 * 60 * 60 * 1000);
  const timePart = pktNow.toISOString().slice(11, 16);
  return `${date}T${timePart}`;
}

function sourceLabel(punch: PunchRow) {
  if (punch.source === "qr_terminal") return "QR terminal";
  if (punch.source === "offline_excel") return "Offline Excel";
  return punch.terminalUser?.name
    ? `Manual by ${punch.terminalUser.name}`
    : "Manual";
}

function getNextDirection(punches: PunchRow[]): PunchDirection {
  const lastPunch = punches.at(-1);
  return lastPunch?.direction === "in" ? "out" : "in";
}

function SummaryCard({
  label,
  value,
  muted,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2">
      <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 text-sm font-black tabular-nums text-foreground",
          muted && "text-muted-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function ManualPunchTimeline({
  employeeId,
  date,
  shifts,
  onSummaryChange,
}: ManualPunchTimelineProps) {
  const punchesQuery = useEmployeePunches(employeeId, date);
  const addPunch = useAddManualPunch();
  const deletePunch = useDeletePunch();
  const correctPunch = useCorrectPunch();
  const [newTimestamp, setNewTimestamp] = useState(defaultPunchDateTime(date));
  const [newNote, setNewNote] = useState("");
  const [editingPunchId, setEditingPunchId] = useState<string | null>(null);
  const [editingTimestamp, setEditingTimestamp] = useState("");
  const [editingReason, setEditingReason] = useState("");
  const [deletePunchId, setDeletePunchId] = useState<string | null>(null);
  const [deleteReason, setDeleteReason] = useState("");
  const [isAddingLocked, setIsAddingLocked] = useState(false);
  const addPunchLockRef = useRef(false);

  const punches = (punchesQuery.data ?? []) as PunchRow[];
  const suggestedDirection = getNextDirection(punches);
  const protectedDeletePunchIds = getProtectedDeletePunchIds(punches);
  const summary = computeAttendanceFromPunches(
    punches.map((punch) => ({
      direction: punch.direction,
      timestamp: punch.timestamp,
    })),
    {
      shifts: shifts ?? [],
      graceMinutes: DEFAULT_GRACE_MINUTES,
      nightShiftStartHour: NIGHT_SHIFT_START_HOUR,
    },
  );

  const emitSummary = useEffectEvent(
    (nextSummary: RecomputeResult, punchCount: number, isLoaded: boolean) => {
      onSummaryChange?.(nextSummary, punchCount, isLoaded);
    },
  );

  useEffect(() => {
    setNewTimestamp(defaultPunchDateTime(date));
  }, [date]);

  useEffect(() => {
    emitSummary(summary, punches.length, !punchesQuery.isLoading);
  }, [
    punchesQuery.isLoading,
    punches.length,
    summary.checkIn,
    summary.checkOut,
    summary.dutyHours,
    summary.earlyDepartureStatus,
    summary.isLate,
    summary.isNightShift,
    summary.openInCount,
  ]);

  const handleAddPunch = async () => {
    if (addPunchLockRef.current || addPunch.isPending || !newTimestamp) {
      return;
    }

    addPunchLockRef.current = true;
    setIsAddingLocked(true);

    try {
      await addPunch.mutateAsync({
        data: {
          employeeId,
          timestamp: toPKTOffsetTimestamp(newTimestamp),
          attendanceDate: date,
          note: newNote.trim() || null,
        },
      });
      setNewNote("");
    } finally {
      addPunchLockRef.current = false;
      setIsAddingLocked(false);
    }
  };

  const handleStartCorrect = (punch: PunchRow) => {
    setEditingPunchId(punch.id);
    setEditingTimestamp(toDateTimeInputValue(punch.timestamp));
    setEditingReason("");
  };

  const handleCorrectPunch = async (punch: PunchRow) => {
    await correctPunch.mutateAsync({
      data: {
        punchId: punch.id,
        newTimestamp: toPKTOffsetTimestamp(editingTimestamp),
        attendanceDate: date,
        reason:
          punch.source === "offline_excel" ? editingReason.trim() : undefined,
      },
    });
    setEditingPunchId(null);
    setEditingTimestamp("");
    setEditingReason("");
  };

  const handleDeletePunch = async (punch: PunchRow) => {
    await deletePunch.mutateAsync({
      data: {
        punchId: punch.id,
        reason: punch.source === "offline_excel" ? deleteReason.trim() : undefined,
      },
    });
    setDeletePunchId(null);
    setDeleteReason("");
  };

  const isAdding = isAddingLocked || addPunch.isPending;

  return (
    <div className="flex flex-col gap-4">
      <Alert className="border-primary/20 bg-primary/5">
        <ScanLine />
        <AlertTitle>Present records are punch-driven</AlertTitle>
        <AlertDescription>
          Add, correct, or delete punches here. Check-in, check-out, duty hours,
          late status, and night shift are recalculated automatically.
        </AlertDescription>
      </Alert>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
        <SummaryCard label="First In" value={summary.checkIn ?? "--:--"} muted={!summary.checkIn} />
        <SummaryCard label="Last Out" value={summary.checkOut ?? "--:--"} muted={!summary.checkOut} />
        <SummaryCard label="Duty" value={`${summary.dutyHours}h`} />
        <SummaryCard
          label="Early Leave"
          value={summary.earlyDepartureStatus === "none" ? "No" : "Yes"}
          muted={summary.earlyDepartureStatus === "none"}
        />
        <SummaryCard
          label="Late"
          value={summary.isLate ? "Yes" : "No"}
          muted={!summary.isLate}
        />
        <SummaryCard
          label="Open Punches"
          value={String(summary.openInCount)}
          muted={summary.openInCount === 0}
        />
      </div>

      <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
        <FieldGroup className="gap-3">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Field>
              <FieldLabel>Manual punch time</FieldLabel>
              <Input
                type="datetime-local"
                value={newTimestamp}
                onChange={(event) => setNewTimestamp(event.target.value)}
              />
              <FieldDescription>
                The punch is saved against {date}. For night shift checkout,
                pick the next day time here.
              </FieldDescription>
            </Field>
            <div className="flex items-end">
              <Button
                type="button"
                className="w-full"
                disabled={isAdding || !newTimestamp}
                onClick={handleAddPunch}
              >
                {isAdding ? (
                  "Adding..."
                ) : (
                  <>
                    <Plus data-icon="inline-start" />
                    Add punch
                  </>
                )}
              </Button>
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Direction
            </p>
            <p className="mt-1 text-sm font-black text-foreground">
              System decides from time order
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Next expected punch: {suggestedDirection.toUpperCase()}. If a
              time is wrong, correct the punch instead of forcing IN or OUT.
            </p>
          </div>
          <Field>
            <FieldLabel>Note</FieldLabel>
            <Textarea
              value={newNote}
              onChange={(event) => setNewNote(event.target.value)}
              placeholder="Optional reason, e.g. scanner was down or card was missed."
              className="min-h-16 resize-none"
            />
          </Field>
        </FieldGroup>
      </div>

      <div className="flex flex-col gap-2">
        {punchesQuery.isLoading ? (
          <>
            <Skeleton className="h-16 rounded-2xl" />
            <Skeleton className="h-16 rounded-2xl" />
          </>
        ) : punches.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/70 bg-background/50 p-5 text-center">
            <p className="text-sm font-semibold text-foreground">
              No punches yet
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Add the first manual punch to mark this employee present.
            </p>
          </div>
        ) : (
          punches.map((punch, index) => {
            const isEditing = editingPunchId === punch.id;
            const isIn = punch.direction === "in";
            const deleteBlocked = protectedDeletePunchIds.has(punch.id);
            const isOfflinePunch = punch.source === "offline_excel";
            const editReasonInvalid =
              isOfflinePunch && editingReason.trim().length < 5;
            const deleteReasonInvalid =
              isOfflinePunch && deleteReason.trim().length < 5;

            return (
              <div
                key={punch.id}
                className="grid gap-3 rounded-2xl border border-border/60 bg-background/70 p-3 md:grid-cols-[auto_1fr_auto]"
              >
                <div
                  className={cn(
                    "flex size-11 items-center justify-center rounded-2xl border",
                    isIn
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                      : "border-rose-500/30 bg-rose-500/10 text-rose-500",
                  )}
                >
                  <Clock3 />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "rounded-full font-black uppercase",
                        isIn
                          ? "border-emerald-500/30 text-emerald-500"
                          : "border-rose-500/30 text-rose-500",
                      )}
                    >
                      {index + 1}. {punch.direction}
                    </Badge>
                    <span className="text-sm font-black tabular-nums">
                      {toPKTDate(punch.timestamp)} {toPKTTime(punch.timestamp)}
                    </span>
                    <Badge variant="secondary" className="rounded-full">
                      {sourceLabel(punch)}
                    </Badge>
                  </div>
                  {punch.note && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {punch.note}
                    </p>
                  )}
                  {deleteBlocked && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Delete the latest related punch first so the IN/OUT order
                      stays valid.
                    </p>
                  )}
                  {isEditing && (
                    <div className="mt-3 flex flex-col gap-2">
                      <Input
                        type="datetime-local"
                        value={editingTimestamp}
                        onChange={(event) => setEditingTimestamp(event.target.value)}
                        className="md:max-w-64"
                      />
                      {isOfflinePunch && (
                        <Field data-invalid={editReasonInvalid}>
                          <FieldLabel>Offline correction reason</FieldLabel>
                          <Textarea
                            value={editingReason}
                            onChange={(event) =>
                              setEditingReason(event.target.value)
                            }
                            placeholder="Required, e.g. supervisor verified wrong time."
                            aria-invalid={editReasonInvalid}
                            className="min-h-16 resize-none"
                          />
                          <FieldDescription>
                            Required for Offline Excel punches. Minimum 5
                            characters.
                          </FieldDescription>
                        </Field>
                      )}
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          disabled={
                            correctPunch.isPending ||
                            !editingTimestamp ||
                            editReasonInvalid
                          }
                          onClick={() => handleCorrectPunch(punch)}
                        >
                          <Check data-icon="inline-start" />
                          Save
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEditingPunchId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    disabled={isEditing}
                    onClick={() => handleStartCorrect(punch)}
                    title="Correct punch time"
                  >
                    <Pencil />
                  </Button>
                  {isOfflinePunch ? (
                    <AlertDialog
                      open={deletePunchId === punch.id}
                      onOpenChange={(open) => {
                        setDeletePunchId(open ? punch.id : null);
                        if (!open) setDeleteReason("");
                      }}
                    >
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon-sm"
                          disabled={deletePunch.isPending || deleteBlocked}
                          title={
                            deleteBlocked
                              ? "Delete the latest related punch first"
                              : "Delete Offline Excel punch"
                          }
                        >
                          <Trash2 />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>
                            Delete Offline Excel punch?
                          </AlertDialogTitle>
                          <AlertDialogDescription>
                            This keeps the imported row claimed and records an
                            audit entry. Enter the correction reason before
                            deleting.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <Field data-invalid={deleteReasonInvalid}>
                          <FieldLabel>Delete reason</FieldLabel>
                          <Textarea
                            value={deleteReason}
                            onChange={(event) =>
                              setDeleteReason(event.target.value)
                            }
                            placeholder="Required, e.g. duplicate verified by supervisor."
                            aria-invalid={deleteReasonInvalid}
                            className="min-h-20 resize-none"
                          />
                          <FieldDescription>
                            Required for Offline Excel punches. Minimum 5
                            characters.
                          </FieldDescription>
                        </Field>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            disabled={
                              deletePunch.isPending || deleteReasonInvalid
                            }
                            onClick={(event) => {
                              if (deleteReasonInvalid) {
                                event.preventDefault();
                                return;
                              }
                              void handleDeletePunch(punch);
                            }}
                          >
                            Delete punch
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  ) : (
                    <Button
                      type="button"
                      variant="destructive"
                      size="icon-sm"
                      disabled={deletePunch.isPending || deleteBlocked}
                      onClick={() => void handleDeletePunch(punch)}
                      title={
                        deleteBlocked
                          ? "Delete the latest related punch first"
                          : "Delete punch"
                      }
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {summary.openInCount > 0 && (
        <Alert className="border-amber-500/30 bg-amber-500/10">
          <UserRound />
          <AlertTitle>Open punch needs checkout</AlertTitle>
          <AlertDescription>
            This day has an unmatched IN punch. Duty hours will stay low until
            an OUT punch is added.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
