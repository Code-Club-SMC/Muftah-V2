import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { AlertSquareIcon, FileKeyIcon } from "@hugeicons/core-free-icons";
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
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
  useForceRetireOfflineSalesWorkbook,
  useOfflineSalesWorkbooks,
} from "@/hooks/sales/use-offline-sales";
import type { OfflineSalesWorkbookSummary } from "@/lib/sales/offline/contracts";

function dateTime(value: string) {
  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  }).format(new Date(value));
}

function statusVariant(status: OfflineSalesWorkbookSummary["status"]) {
  if (status === "active") return "default" as const;
  if (status === "force_retired") return "destructive" as const;
  return "outline" as const;
}

type RetireState = {
  workbook: OfflineSalesWorkbookSummary;
  reason: string;
} | null;

/**
 * Read-only view of the reserved invoice numbers, plus one emergency action.
 * Everything else happens by itself: the offline desk issues the numbers the
 * first time it is prepared, keeps its price list fresh, and asks for a new set
 * when the old one is used up.
 */
export function WorkbookPanel() {
  const [retireState, setRetireState] = useState<RetireState>(null);
  const workbooks = useOfflineSalesWorkbooks();
  const retire = useForceRetireOfflineSalesWorkbook();
  const active = workbooks.data?.find(
    (workbook) => workbook.status === "active",
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
        <CardTitle>Offline invoice numbers</CardTitle>
        <CardDescription>
          Factory F01 has one active set of 500 reserved invoice numbers. The
          offline desk issues it automatically, so nothing is needed here
          unless the factory computer is lost or stolen.
        </CardDescription>
        <CardAction>
          <Badge variant={active ? "default" : "outline"}>
            {active ? "Ready for outage" : "Not issued yet"}
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
                ? "All invoice numbers are used"
                : "Invoice numbers are running low"}
            </AlertTitle>
            <AlertDescription>
              {active.remainingSlots === 0
                ? "Once the last batch is reviewed, the offline desk gets a new set when it is refreshed."
                : `${active.remainingSlots} invoice numbers remain. The desk gets a new set by itself when they run out.`}
            </AlertDescription>
          </Alert>
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
              <EmptyTitle>Nothing issued yet</EmptyTitle>
              <EmptyDescription>
                The first time someone presses Prepare this computer on the
                offline desk, invoice numbers are issued automatically.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Issued to</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Invoice numbers</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((workbook) => (
                <TableRow key={workbook.id}>
                  <TableCell className="font-medium">
                    {workbook.operatorName}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(workbook.status)}>
                      {workbook.status === "force_retired"
                        ? "Retired"
                        : workbook.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {workbook.remainingSlots.toLocaleString("en-PK")} left ·{" "}
                    {workbook.usedSlots.toLocaleString("en-PK")} used
                  </TableCell>
                  <TableCell>{dateTime(workbook.issuedAt)}</TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={
                          workbook.status !== "active" || retire.isPending
                        }
                        onClick={() => setRetireState({ workbook, reason: "" })}
                      >
                        Computer lost or stolen
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
        open={Boolean(retireState)}
        onOpenChange={(open) => !open && setRetireState(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retire these invoice numbers?</AlertDialogTitle>
            <AlertDialogDescription>
              Use only when the offline computer is lost, stolen or no longer
              trusted. Invoices sent from it later will need explicit review,
              and the next time the desk is prepared it gets a new set.
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
                placeholder="Example: factory computer was stolen"
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
              Retire numbers
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
