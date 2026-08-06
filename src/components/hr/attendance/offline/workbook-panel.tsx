import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertSquareIcon,
  Download02Icon,
  FileKeyIcon,
  Refresh03Icon,
  UserSearch01Icon,
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
import {
  Field,
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
  useDownloadOfflineAttendanceWorkbook,
  useIssueOfflineAttendanceWorkbook,
  useOfflineAttendanceOperators,
  useOfflineAttendanceWorkbooks,
  useReplaceOfflineAttendanceWorkbook,
  useRetireOfflineAttendanceWorkbook,
} from "@/hooks/hr/use-offline-attendance";
import type { OfflineWorkbookSummary } from "@/lib/attendance/offline/contracts";

function formatDateTime(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  }).format(new Date(value));
}

function workbookStatusVariant(status: OfflineWorkbookSummary["status"]) {
  if (status === "active") return "default";
  if (status === "retired") return "destructive";
  return "outline";
}

type RetireDialogState = {
  workbook: OfflineWorkbookSummary;
  reason: string;
} | null;

export function WorkbookPanel() {
  const [operatorUserId, setOperatorUserId] = useState("");
  const [retireDialog, setRetireDialog] = useState<RetireDialogState>(null);
  const workbooks = useOfflineAttendanceWorkbooks();
  const operators = useOfflineAttendanceOperators();
  const issueWorkbook = useIssueOfflineAttendanceWorkbook();
  const downloadWorkbook = useDownloadOfflineAttendanceWorkbook();
  const replaceWorkbook = useReplaceOfflineAttendanceWorkbook();
  const retireWorkbook = useRetireOfflineAttendanceWorkbook();

  const activeWorkbooks =
    workbooks.data?.filter((workbook) => workbook.status === "active").length ?? 0;
  const selectedOperator = operators.data?.find(
    (operator) => operator.id === operatorUserId,
  );
  const selectedOperatorHasActiveWorkbook = workbooks.data?.some(
    (workbook) =>
      workbook.operatorUserId === operatorUserId && workbook.status === "active",
  );

  const isLoading = workbooks.isLoading || operators.isLoading;
  const retireReason = retireDialog?.reason.trim() ?? "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Offline Excel workbooks</CardTitle>
        <CardDescription>
          Issue one signed workbook per attendance terminal operator. File can be
          downloaded again, but app does not store Excel contents.
        </CardDescription>
        <CardAction>
          <Badge variant="secondary">{activeWorkbooks} active</Badge>
        </CardAction>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        <Alert>
          <HugeiconsIcon icon={FileKeyIcon} strokeWidth={2} />
          <AlertTitle>Rule</AlertTitle>
          <AlertDescription>
            Use assigned workbook during outage. After internet returns, upload it.
            Web app reads rows and saves only attendance data to database.
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <FieldGroup className="gap-3">
            <Field data-disabled={operators.isLoading}>
              <FieldLabel>Attendance terminal operator</FieldLabel>
              <Select
                value={operatorUserId}
                onValueChange={setOperatorUserId}
                disabled={operators.isLoading || issueWorkbook.isPending}
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
                Only users with attendance terminal scan permission appear here.
              </FieldDescription>
            </Field>
          </FieldGroup>

          <Button
            disabled={
              !operatorUserId ||
              issueWorkbook.isPending ||
              Boolean(selectedOperatorHasActiveWorkbook)
            }
            onClick={() =>
              issueWorkbook.mutate(
                { operatorUserId },
                { onSuccess: () => setOperatorUserId("") },
              )
            }
          >
            <HugeiconsIcon
              icon={FileKeyIcon}
              strokeWidth={2}
              data-icon="inline-start"
            />
            {issueWorkbook.isPending ? "Issuing..." : "Issue workbook"}
          </Button>
        </div>

        {selectedOperatorHasActiveWorkbook && selectedOperator && (
          <Alert variant="destructive">
            <HugeiconsIcon icon={AlertSquareIcon} strokeWidth={2} />
            <AlertTitle>Already active</AlertTitle>
            <AlertDescription>
              {selectedOperator.name} already has active workbook. Replace or
              retire old workbook first.
            </AlertDescription>
          </Alert>
        )}

        {operators.data?.length === 0 && (
          <Alert>
            <HugeiconsIcon icon={UserSearch01Icon} strokeWidth={2} />
            <AlertTitle>No terminal users found</AlertTitle>
            <AlertDescription>
              Create/assign attendance terminal account first, then issue workbook.
            </AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Operator</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Rows left</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(workbooks.data ?? []).map((workbook) => (
                <TableRow key={workbook.id}>
                  <TableCell>
                    <div className="flex flex-col gap-1">
                      <span className="font-medium">{workbook.operatorName}</span>
                      <span className="text-xs text-muted-foreground truncate">
                        {workbook.id}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={workbookStatusVariant(workbook.status)}>
                      {workbook.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {workbook.remainingRows.toLocaleString("en-PK")} /{" "}
                    {workbook.rowCapacity.toLocaleString("en-PK")}
                  </TableCell>
                  <TableCell>{formatDateTime(workbook.issuedAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          downloadWorkbook.isPending ||
                          workbook.status !== "active"
                        }
                        onClick={() => downloadWorkbook.mutate(workbook.id)}
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
                          replaceWorkbook.isPending ||
                          workbook.status !== "active"
                        }
                        onClick={() => replaceWorkbook.mutate(workbook.id)}
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
                          retireWorkbook.isPending ||
                          workbook.status !== "active"
                        }
                        onClick={() => setRetireDialog({ workbook, reason: "" })}
                      >
                        Retire
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
        open={Boolean(retireDialog)}
        onOpenChange={(open) => {
          if (!open) setRetireDialog(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire offline workbook?</AlertDialogTitle>
            <AlertDialogDescription>
              Retired workbook cannot accept uploads. Use this when workbook is
              lost, damaged, or no longer safe.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FieldGroup>
            <Field
              data-invalid={retireReason.length > 0 && retireReason.length < 5}
            >
              <FieldLabel htmlFor="retire-reason">Reason</FieldLabel>
              <Textarea
                id="retire-reason"
                value={retireDialog?.reason ?? ""}
                aria-invalid={retireReason.length > 0 && retireReason.length < 5}
                placeholder="Required, e.g. old workbook lost by operator."
                onChange={(event) =>
                  setRetireDialog((current) =>
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
              disabled={retireReason.length < 5 || retireWorkbook.isPending}
              onClick={(event) => {
                event.preventDefault();
                if (!retireDialog || retireReason.length < 5) return;

                retireWorkbook.mutate(
                  {
                    workbookId: retireDialog.workbook.id,
                    reason: retireReason,
                  },
                  { onSuccess: () => setRetireDialog(null) },
                );
              }}
            >
              Retire workbook
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
