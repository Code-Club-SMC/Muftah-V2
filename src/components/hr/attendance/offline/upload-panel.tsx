import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertSquareIcon,
  Calendar02Icon,
  Database01Icon,
  FileUploadIcon,
  Refresh03Icon,
} from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  useConfirmOfflineAttendanceImport,
  useConfirmOfflineOutageWindow,
  useExcludeOfflineImportRows,
  useOfflineImportBatch,
  useOfflineImportQueues,
  useRefreshOfflineImportPreview,
  useRejectOfflineOutageWindow,
  useUploadOfflineAttendanceWorkbook,
} from "@/hooks/hr/use-offline-attendance";
import type { OfflineImportCounts } from "@/lib/attendance/offline/contracts";
import type {
  OfflineImportPreviewGroup,
  OfflineImportQueueItem,
  OfflinePreviewTimelineEvent,
} from "@/lib/attendance/offline/preview.server";
import type { ClassifiedOfflineRow } from "@/lib/attendance/offline/timeline";

const PKT_OFFSET = "+05:00";

type UploadState = {
  outageStartsAt: string;
  outageEndsAt: string;
  reason: string;
};

type DecisionState = {
  batchId: string;
  startsAt: string;
  endsAt: string;
  reason: string;
};

const emptyDecision: DecisionState = {
  batchId: "",
  startsAt: "",
  endsAt: "",
  reason: "",
};

function toPktDateTimeIso(value: string) {
  if (!value) return value;
  const withSeconds = value.length === 16 ? `${value}:00` : value;
  return `${withSeconds}${PKT_OFFSET}`;
}

function toPktDateTimeLocal(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  }).format(new Date(value));
}

function countSummary(counts: OfflineImportCounts) {
  return [
    ["Total", counts.totalRows],
    ["Ready", counts.readyRows],
    ["Review", counts.reviewRows],
    ["Invalid", counts.invalidRows],
    ["Blocked", counts.blockedRows],
    ["Duplicates", counts.duplicateRows],
    ["Imported", counts.importedRows],
    ["Excluded", counts.excludedRows],
  ] as const;
}

function statusVariant(status: ClassifiedOfflineRow["status"]) {
  if (status === "ready" || status === "imported") return "default";
  if (status === "invalid" || status === "blocked") return "destructive";
  if (status === "needs_review") return "secondary";
  return "outline";
}

function queueLabel(item: OfflineImportQueueItem) {
  return `${item.operatorName ?? "Unknown operator"} · ${formatDateTime(item.uploadedAt)}`;
}

function canExcludeRow(row: ClassifiedOfflineRow) {
  return (
    row.status === "needs_review" ||
    row.status === "invalid" ||
    row.status === "blocked"
  );
}

function sourceLabel(source: OfflinePreviewTimelineEvent["source"]) {
  if (source === "qr_terminal") return "QR";
  if (source === "manual") return "Manual";
  return "Excel";
}

function TimelineList({ events }: { events: OfflinePreviewTimelineEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No usable timeline events yet.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {events.map((event) => (
        <Badge key={event.id} variant="outline">
          {sourceLabel(event.source)} {event.direction.toUpperCase()} ·{" "}
          {formatDateTime(event.timestamp)}
        </Badge>
      ))}
    </div>
  );
}

function CountsGrid({ counts }: { counts: OfflineImportCounts }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {countSummary(counts).map(([label, value]) => (
        <div key={label} className="rounded-xl border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums">
            {value.toLocaleString("en-PK")}
          </p>
        </div>
      ))}
    </div>
  );
}

function QueueItemButton({
  item,
  selected,
  onSelect,
}: {
  item: OfflineImportQueueItem;
  selected: boolean;
  onSelect: (item: OfflineImportQueueItem) => void;
}) {
  return (
    <Button
      variant={selected ? "default" : "outline"}
      className="h-auto justify-start rounded-xl px-4 py-3"
      onClick={() => onSelect(item)}
    >
      <span className="flex min-w-0 flex-col items-start gap-1 text-left">
        <span className="truncate">{queueLabel(item)}</span>
        <span className="text-xs opacity-80">
          {formatDateTime(item.startsAt)} → {formatDateTime(item.endsAt)}
        </span>
      </span>
    </Button>
  );
}

function PreviewGroup({
  group,
  selectedRowIds,
  onToggleRow,
}: {
  group: OfflineImportPreviewGroup;
  selectedRowIds: Set<string>;
  onToggleRow: (rowId: string, checked: boolean) => void;
}) {
  return (
    <div className="rounded-xl border">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="font-medium">
              Employee {group.employeeId} · {group.attendanceDate}
            </p>
            <p className="text-sm text-muted-foreground">
              {group.rowCount} rows, {group.readyRowCount} ready
            </p>
          </div>
          <Badge variant={statusVariant(group.status)}>{group.status}</Badge>
        </div>
        <TimelineList events={group.timeline} />
      </div>
      <Separator />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Select</TableHead>
            <TableHead>Row</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Time</TableHead>
            <TableHead>Direction</TableHead>
            <TableHead>Reason</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell>
                <Checkbox
                  checked={selectedRowIds.has(row.id)}
                  disabled={!canExcludeRow(row)}
                  onCheckedChange={(checked) =>
                    onToggleRow(row.id, checked === true)
                  }
                  aria-label={`Select offline row ${row.worksheetRowNumber ?? row.id}`}
                />
              </TableCell>
              <TableCell>{row.worksheetRowNumber ?? "—"}</TableCell>
              <TableCell>
                <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
              </TableCell>
              <TableCell>{formatDateTime(row.normalizedTimestamp)}</TableCell>
              <TableCell>{row.rawDirection ?? "—"}</TableCell>
              <TableCell className="max-w-sm whitespace-normal">
                {row.reasonMessage ?? row.reasonCode ?? "—"}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function UploadPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>({
    outageStartsAt: "",
    outageEndsAt: "",
    reason: "",
  });
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [decision, setDecision] = useState<DecisionState>(emptyDecision);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const [excludeReason, setExcludeReason] = useState("");

  const queues = useOfflineImportQueues();
  const uploadWorkbook = useUploadOfflineAttendanceWorkbook();
  const confirmOutage = useConfirmOfflineOutageWindow();
  const rejectOutage = useRejectOfflineOutageWindow();
  const preview = useOfflineImportBatch(selectedBatchId);
  const refreshPreview = useRefreshOfflineImportPreview();
  const excludeRows = useExcludeOfflineImportRows();
  const confirmImport = useConfirmOfflineAttendanceImport();

  const awaitingSupervisor = queues.data?.awaitingSupervisor ?? [];
  const readyForReview = queues.data?.readyForReview ?? [];
  const selectedQueueItem = useMemo(
    () =>
      [...awaitingSupervisor, ...readyForReview].find(
        (item) => item.batchId === selectedBatchId,
      ) ?? null,
    [awaitingSupervisor, readyForReview, selectedBatchId],
  );
  const canSubmitUpload =
    Boolean(file) &&
    uploadState.outageStartsAt &&
    uploadState.outageEndsAt &&
    uploadState.reason.trim().length >= 5 &&
    !uploadWorkbook.isPending;
  const canConfirmDecision =
    decision.batchId &&
    decision.startsAt &&
    decision.endsAt &&
    decision.reason.trim().length >= 5;
  const canExclude =
    selectedBatchId &&
    selectedRowIds.size > 0 &&
    excludeReason.trim().length >= 5 &&
    !excludeRows.isPending;

  useEffect(() => {
    if (selectedBatchId) return;
    const first = readyForReview[0] ?? awaitingSupervisor[0];
    if (first) setSelectedBatchId(first.batchId);
  }, [awaitingSupervisor, readyForReview, selectedBatchId]);

  useEffect(() => {
    setSelectedRowIds(new Set());
    setExcludeReason("");
  }, [selectedBatchId]);

  const selectQueueItem = (item: OfflineImportQueueItem) => {
    setSelectedBatchId(item.batchId);
    setDecision({
      batchId: item.batchId,
      startsAt: toPktDateTimeLocal(item.startsAt),
      endsAt: toPktDateTimeLocal(item.endsAt),
      reason: item.reason ?? "",
    });
  };

  const handleUpload = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file || !canSubmitUpload) return;

    const form = new FormData();
    form.set("file", file);
    form.set("outageStartsAt", toPktDateTimeIso(uploadState.outageStartsAt));
    form.set("outageEndsAt", toPktDateTimeIso(uploadState.outageEndsAt));
    form.set("reason", uploadState.reason.trim());

    uploadWorkbook.mutate(form, {
      onSuccess: (result) => {
        setSelectedBatchId(result.batchId);
        setFile(null);
      },
    });
  };

  const handleToggleRow = (rowId: string, checked: boolean) => {
    setSelectedRowIds((current) => {
      const next = new Set(current);
      if (checked) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload and review offline attendance</CardTitle>
        <CardDescription>
          Upload workbook after internet returns. Supervisor confirms outage,
          reviewer imports approved rows.
        </CardDescription>
        <CardAction>
          <Badge variant="secondary">
            {awaitingSupervisor.length + readyForReview.length} pending
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-8">
        <form className="flex flex-col gap-4" onSubmit={handleUpload}>
          <FieldGroup className="grid gap-4 lg:grid-cols-2">
            <Field
              className="lg:col-span-2"
              data-invalid={uploadWorkbook.isError}
            >
              <FieldLabel htmlFor="offline-workbook-file">Excel workbook</FieldLabel>
              <Input
                id="offline-workbook-file"
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                aria-invalid={uploadWorkbook.isError}
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <FieldDescription>
                Upload `.xlsx` only. Server reads rows, then discards file bytes.
              </FieldDescription>
            </Field>

            <Field>
              <FieldLabel htmlFor="outage-start">Outage start</FieldLabel>
              <Input
                id="outage-start"
                type="datetime-local"
                value={uploadState.outageStartsAt}
                onChange={(event) =>
                  setUploadState((current) => ({
                    ...current,
                    outageStartsAt: event.target.value,
                  }))
                }
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="outage-end">Outage end</FieldLabel>
              <Input
                id="outage-end"
                type="datetime-local"
                value={uploadState.outageEndsAt}
                onChange={(event) =>
                  setUploadState((current) => ({
                    ...current,
                    outageEndsAt: event.target.value,
                  }))
                }
              />
            </Field>

            <Field
              className="lg:col-span-2"
              data-invalid={
                uploadState.reason.length > 0 &&
                uploadState.reason.trim().length < 5
              }
            >
              <FieldLabel htmlFor="outage-reason">Outage reason</FieldLabel>
              <Textarea
                id="outage-reason"
                value={uploadState.reason}
                aria-invalid={
                  uploadState.reason.length > 0 &&
                  uploadState.reason.trim().length < 5
                }
                placeholder="Example: ISP outage from 08:40 to 11:20, operator used assigned workbook."
                onChange={(event) =>
                  setUploadState((current) => ({
                    ...current,
                    reason: event.target.value,
                  }))
                }
              />
            </Field>
          </FieldGroup>

          <div>
            <Button type="submit" disabled={!canSubmitUpload}>
              <HugeiconsIcon
                icon={FileUploadIcon}
                strokeWidth={2}
                data-icon="inline-start"
              />
              {uploadWorkbook.isPending ? "Uploading..." : "Upload workbook"}
            </Button>
          </div>
        </form>

        <Separator />

        <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">Supervisor queue</h3>
                <Badge variant="outline">{awaitingSupervisor.length}</Badge>
              </div>
              {queues.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : awaitingSupervisor.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No outage waiting for confirmation.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {awaitingSupervisor.map((item) => (
                    <QueueItemButton
                      key={item.batchId}
                      item={item}
                      selected={selectedBatchId === item.batchId}
                      onSelect={selectQueueItem}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-medium">Review queue</h3>
                <Badge variant="outline">{readyForReview.length}</Badge>
              </div>
              {queues.isLoading ? (
                <Skeleton className="h-24 w-full" />
              ) : readyForReview.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No preview ready for final import.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {readyForReview.map((item) => (
                    <QueueItemButton
                      key={item.batchId}
                      item={item}
                      selected={selectedBatchId === item.batchId}
                      onSelect={selectQueueItem}
                    />
                  ))}
                </div>
              )}
            </section>

            <section className="flex flex-col gap-4 rounded-xl border p-4">
              <div className="flex items-center gap-2">
                <HugeiconsIcon
                  icon={Calendar02Icon}
                  strokeWidth={2}
                  className="size-4"
                />
                <h3 className="font-medium">Supervisor decision</h3>
              </div>
              <FieldGroup className="gap-4">
                <Field>
                  <FieldLabel htmlFor="decision-start">Confirmed start</FieldLabel>
                  <Input
                    id="decision-start"
                    type="datetime-local"
                    value={decision.startsAt}
                    onChange={(event) =>
                      setDecision((current) => ({
                        ...current,
                        startsAt: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="decision-end">Confirmed end</FieldLabel>
                  <Input
                    id="decision-end"
                    type="datetime-local"
                    value={decision.endsAt}
                    onChange={(event) =>
                      setDecision((current) => ({
                        ...current,
                        endsAt: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field
                  data-invalid={
                    decision.reason.length > 0 &&
                    decision.reason.trim().length < 5
                  }
                >
                  <FieldLabel htmlFor="decision-reason">Decision reason</FieldLabel>
                  <Textarea
                    id="decision-reason"
                    value={decision.reason}
                    aria-invalid={
                      decision.reason.length > 0 &&
                      decision.reason.trim().length < 5
                    }
                    placeholder="Supervisor-confirmed outage reason."
                    onChange={(event) =>
                      setDecision((current) => ({
                        ...current,
                        reason: event.target.value,
                      }))
                    }
                  />
                </Field>
              </FieldGroup>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={!canConfirmDecision || confirmOutage.isPending}
                  onClick={() =>
                    confirmOutage.mutate({
                      batchId: decision.batchId,
                      startsAt: toPktDateTimeIso(decision.startsAt),
                      endsAt: toPktDateTimeIso(decision.endsAt),
                      reason: decision.reason.trim(),
                    })
                  }
                >
                  Confirm outage
                </Button>
                <Button
                  variant="destructive"
                  disabled={!canConfirmDecision || rejectOutage.isPending}
                  onClick={() =>
                    rejectOutage.mutate({
                      batchId: decision.batchId,
                      reason: decision.reason.trim(),
                    })
                  }
                >
                  Reject
                </Button>
              </div>
            </section>
          </div>

          <section className="flex min-w-0 flex-col gap-5">
            {!selectedBatchId ? (
              <Alert>
                <HugeiconsIcon icon={AlertSquareIcon} strokeWidth={2} />
                <AlertTitle>No batch selected</AlertTitle>
                <AlertDescription>
                  Upload workbook or select queue item to see preview.
                </AlertDescription>
              </Alert>
            ) : preview.isLoading ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-24 w-full" />
                <Skeleton className="h-48 w-full" />
              </div>
            ) : preview.data ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-medium">Batch preview</h3>
                    <p className="text-sm text-muted-foreground">
                      {selectedQueueItem ? queueLabel(selectedQueueItem) : selectedBatchId}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      Terminal heartbeat rows during outage:{" "}
                      {preview.data.heartbeatCount.toLocaleString("en-PK")}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={refreshPreview.isPending}
                      onClick={() => refreshPreview.mutate(preview.data.batchId)}
                    >
                      <HugeiconsIcon
                        icon={Refresh03Icon}
                        strokeWidth={2}
                        data-icon="inline-start"
                      />
                      Refresh
                    </Button>
                    <Button
                      disabled={
                        confirmImport.isPending ||
                        preview.data.counts.readyRows === 0
                      }
                      onClick={() => confirmImport.mutate(preview.data.batchId)}
                    >
                      <HugeiconsIcon
                        icon={Database01Icon}
                        strokeWidth={2}
                        data-icon="inline-start"
                      />
                      {confirmImport.isPending
                        ? "Importing..."
                        : "Import ready rows"}
                    </Button>
                  </div>
                </div>

                <CountsGrid counts={preview.data.counts} />

                <div className="flex flex-col gap-3 rounded-xl border p-4">
                  <Field
                    data-invalid={
                      excludeReason.length > 0 &&
                      excludeReason.trim().length < 5
                    }
                  >
                    <FieldLabel htmlFor="exclude-reason">Exclude reason</FieldLabel>
                    <Textarea
                      id="exclude-reason"
                      value={excludeReason}
                      aria-invalid={
                        excludeReason.length > 0 &&
                        excludeReason.trim().length < 5
                      }
                      placeholder="Required before excluding selected bad rows."
                      onChange={(event) => setExcludeReason(event.target.value)}
                    />
                    <FieldDescription>
                      Only review, invalid, or blocked rows can be excluded.
                    </FieldDescription>
                  </Field>
                  <Button
                    variant="outline"
                    disabled={!canExclude}
                    onClick={() =>
                      selectedBatchId &&
                      excludeRows.mutate(
                        {
                          batchId: selectedBatchId,
                          rowIds: [...selectedRowIds],
                          reason: excludeReason.trim(),
                        },
                        {
                          onSuccess: () => {
                            setSelectedRowIds(new Set());
                            setExcludeReason("");
                          },
                        },
                      )
                    }
                  >
                    Exclude selected rows ({selectedRowIds.size})
                  </Button>
                </div>

                {preview.data.groups.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Workbook has no rows to review.
                  </p>
                ) : (
                  <div className="flex flex-col gap-4">
                    {preview.data.groups.map((group) => (
                      <PreviewGroup
                        key={group.key}
                        group={group}
                        selectedRowIds={selectedRowIds}
                        onToggleRow={handleToggleRow}
                      />
                    ))}
                  </div>
                )}
              </>
            ) : (
              <Alert variant="destructive">
                <HugeiconsIcon icon={AlertSquareIcon} strokeWidth={2} />
                <AlertTitle>Preview unavailable</AlertTitle>
                <AlertDescription>
                  {preview.error?.message ?? "Could not load selected batch."}
                </AlertDescription>
              </Alert>
            )}
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
