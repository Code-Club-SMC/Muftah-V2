import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertSquareIcon,
  Download02Icon,
  FileKeyIcon,
  Refresh03Icon,
} from "@hugeicons/core-free-icons";
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
} from "@/components/ui/alert-dialog";
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
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
  useDownloadOfflineSalesWorkbook,
  useForceRetireOfflineSalesWorkbook,
  useIssueOfflineSalesWorkbook,
  useOfflineSalesOperators,
  useOfflineSalesWorkbooks,
  useReplaceOfflineSalesWorkbook,
} from "@/hooks/sales/use-offline-sales";
import type { OfflineSalesWorkbookSummary } from "@/lib/sales/offline/contracts";

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  }).format(new Date(value));
}

function snapshotAge(value: string) {
  const days = Math.max(
    0,
    Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000),
  );
  return days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"} old`;
}

function statusVariant(status: OfflineSalesWorkbookSummary["status"]) {
  if (status === "active") return "default" as const;
  if (status === "force_retired") return "destructive" as const;
  return "outline" as const;
}

type ReplaceState = {
  workbook: OfflineSalesWorkbookSummary;
  usedRowsUploaded: boolean;
  operatorUserId: string;
} | null;

type RetireState = {
  workbook: OfflineSalesWorkbookSummary;
  reason: string;
} | null;

export function WorkbookPanel() {
  const [operatorUserId, setOperatorUserId] = useState("");
  const [replaceState, setReplaceState] = useState<ReplaceState>(null);
  const [retireState, setRetireState] = useState<RetireState>(null);
  const workbooks = useOfflineSalesWorkbooks();
  const operators = useOfflineSalesOperators();
  const issue = useIssueOfflineSalesWorkbook();
  const download = useDownloadOfflineSalesWorkbook();
  const replace = useReplaceOfflineSalesWorkbook();
  const retire = useForceRetireOfflineSalesWorkbook();
  const active = workbooks.data?.find(
    (workbook) => workbook.status === "active",
  );
  const selectedOperator = operators.data?.find(
    (operator) => operator.id === operatorUserId,
  );
  const sorted = useMemo(
    () =>
      [...(workbooks.data ?? [])].sort((a, b) =>
        b.issuedAt.localeCompare(a.issuedAt),
      ),
    [workbooks.data],
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Official factory workbook</CardTitle>
        <CardDescription>
          Factory F01 can have one active signed workbook and one designated
          operator. The app rebuilds downloads from database metadata; it does
          not store Excel files.
        </CardDescription>
        <CardAction>
          <Badge variant={active ? "default" : "destructive"}>
            {active ? "Ready for outage" : "No active workbook"}
          </Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {active && active.remainingSlots <= 50 && (
          <Alert
            variant={active.remainingSlots === 0 ? "destructive" : "default"}
          >
            <HugeiconsIcon icon={AlertSquareIcon} strokeWidth={2} />
            <AlertTitle>
              {active.remainingSlots === 0
                ? "Workbook is full"
                : "Workbook is running low"}
            </AlertTitle>
            <AlertDescription>
              {active.remainingSlots === 0
                ? "No invoice slots remain. Upload all used rows, then replace this workbook before another outage."
                : `${active.remainingSlots} invoice slots remain. Plan a safe replacement soon.`}
            </AlertDescription>
          </Alert>
        )}

        {!active && (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <FieldGroup className="gap-3">
              <Field data-disabled={operators.isLoading}>
                <FieldLabel>Designated operator</FieldLabel>
                <Select
                  value={operatorUserId}
                  onValueChange={setOperatorUserId}
                  disabled={operators.isLoading || issue.isPending}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select operator user" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      {(operators.data ?? []).map((operator) => (
                        <SelectItem key={operator.id} value={operator.id}>
                          {operator.name} · {operator.email}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <FieldDescription>
                  This person keeps and fills the official workbook during an
                  outage.
                </FieldDescription>
              </Field>
            </FieldGroup>
            <Button
              disabled={!selectedOperator || issue.isPending}
              onClick={() =>
                issue.mutate(operatorUserId, {
                  onSuccess: () => setOperatorUserId(""),
                })
              }
            >
              {issue.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <HugeiconsIcon
                  icon={FileKeyIcon}
                  strokeWidth={2}
                  data-icon="inline-start"
                />
              )}
              Issue workbook
            </Button>
          </div>
        )}

        {workbooks.isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : sorted.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={FileKeyIcon} strokeWidth={2} />
              </EmptyMedia>
              <EmptyTitle>No workbook issued</EmptyTitle>
              <EmptyDescription>
                Choose the factory operator above and issue the first official
                workbook.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operator</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invoice slots</TableHead>
                <TableHead>Snapshot</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((workbook) => (
                <TableRow key={workbook.id}>
                  <TableCell>
                    <div className="flex max-w-56 flex-col gap-1">
                      <span className="font-medium">
                        {workbook.operatorName}
                      </span>
                      <span className="truncate font-mono text-xs text-muted-foreground">
                        {workbook.id}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(workbook.status)}>
                      {workbook.status === "force_retired"
                        ? "Force retired"
                        : workbook.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {workbook.remainingSlots.toLocaleString("en-PK")} left ·{" "}
                    {workbook.usedSlots.toLocaleString("en-PK")} used
                  </TableCell>
                  <TableCell>
                    {snapshotAge(workbook.snapshotGeneratedAt)}
                  </TableCell>
                  <TableCell>{dateTime(workbook.issuedAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          workbook.status !== "active" || download.isPending
                        }
                        onClick={() => download.mutate(workbook.id)}
                      >
                        <HugeiconsIcon
                          icon={Download02Icon}
                          strokeWidth={2}
                          data-icon="inline-start"
                        />
                        Download
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          workbook.status !== "active" || replace.isPending
                        }
                        onClick={() =>
                          setReplaceState({
                            workbook,
                            usedRowsUploaded: false,
                            operatorUserId: workbook.operatorUserId,
                          })
                        }
                      >
                        <HugeiconsIcon
                          icon={Refresh03Icon}
                          strokeWidth={2}
                          data-icon="inline-start"
                        />
                        Replace
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={
                          workbook.status !== "active" || retire.isPending
                        }
                        onClick={() => setRetireState({ workbook, reason: "" })}
                      >
                        Force retire
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AlertDialog
        open={Boolean(replaceState)}
        onOpenChange={(open) => !open && setReplaceState(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Replace official workbook?</AlertDialogTitle>
            <AlertDialogDescription>
              Old unused invoice numbers will be closed. A new signed workbook
              will be issued after all used rows have been uploaded.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel>Operator for new workbook</FieldLabel>
              <Select
                value={replaceState?.operatorUserId ?? ""}
                onValueChange={(value) =>
                  setReplaceState((current) =>
                    current ? { ...current, operatorUserId: value } : current,
                  )
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select operator" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {(operators.data ?? []).map((operator) => (
                      <SelectItem key={operator.id} value={operator.id}>
                        {operator.name} · {operator.email}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field orientation="horizontal">
              <Checkbox
                id="used-rows-uploaded"
                checked={replaceState?.usedRowsUploaded ?? false}
                onCheckedChange={(checked) =>
                  setReplaceState((current) =>
                    current
                      ? { ...current, usedRowsUploaded: checked === true }
                      : current,
                  )
                }
              />
              <FieldContent>
                <FieldLabel htmlFor="used-rows-uploaded">
                  I confirm every used row from the old workbook has been
                  uploaded.
                </FieldLabel>
                <FieldDescription>
                  Replacement is blocked while an upload still needs review.
                </FieldDescription>
              </FieldContent>
            </Field>
          </FieldGroup>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={
                !replaceState?.usedRowsUploaded ||
                !replaceState.operatorUserId ||
                replace.isPending
              }
              onClick={(event) => {
                event.preventDefault();
                if (!replaceState?.usedRowsUploaded) return;
                replace.mutate(
                  {
                    workbookId: replaceState.workbook.id,
                    usedRowsUploaded: true,
                    operatorUserId: replaceState.operatorUserId,
                  },
                  { onSuccess: () => setReplaceState(null) },
                );
              }}
            >
              {replace.isPending && <Spinner data-icon="inline-start" />}
              Replace workbook
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(retireState)}
        onOpenChange={(open) => !open && setRetireState(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Force-retire unsafe workbook?</AlertDialogTitle>
            <AlertDialogDescription>
              Use only when the file is lost, copied, damaged, or no longer
              trusted. Later uploads from it will require explicit review.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FieldGroup>
            <Field
              data-invalid={
                Boolean(retireState?.reason.trim()) &&
                (retireState?.reason.trim().length ?? 0) < 5
              }
            >
              <FieldLabel htmlFor="force-retire-reason">Reason</FieldLabel>
              <Textarea
                id="force-retire-reason"
                value={retireState?.reason ?? ""}
                aria-invalid={
                  Boolean(retireState?.reason.trim()) &&
                  (retireState?.reason.trim().length ?? 0) < 5
                }
                placeholder="Example: workbook copied to an unknown computer"
                onChange={(event) =>
                  setRetireState((current) =>
                    current
                      ? { ...current, reason: event.target.value }
                      : current,
                  )
                }
              />
            </Field>
          </FieldGroup>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={
                (retireState?.reason.trim().length ?? 0) < 5 || retire.isPending
              }
              onClick={(event) => {
                event.preventDefault();
                if (!retireState || retireState.reason.trim().length < 5)
                  return;
                retire.mutate(
                  {
                    workbookId: retireState.workbook.id,
                    reason: retireState.reason.trim(),
                  },
                  { onSuccess: () => setRetireState(null) },
                );
              }}
            >
              {retire.isPending && <Spinner data-icon="inline-start" />}
              Force retire
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
