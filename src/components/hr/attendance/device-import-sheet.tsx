import { useId, useState, type ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { endOfMonth, format, parseISO, startOfMonth } from "date-fns";
import { HugeiconsIcon } from "@hugeicons/react";
import { FileUploadIcon } from "@hugeicons/core-free-icons";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
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
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
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
import {
  useConfirmDeviceAttendance,
  useDeviceAttendanceImports,
  useDiscardDeviceAttendanceImport,
  usePreviewDeviceAttendance,
  useUndoDeviceAttendanceImport,
  useUnlinkDevicePerson,
  useUploadDeviceAttendance,
} from "@/hooks/hr/use-device-attendance";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import {
  DEVICE_IMPORT_MAX_BYTES,
  type DeviceImportMappings,
  type DeviceImportPreview,
  type DeviceImportRowStatus,
  type DeviceImportStatus,
} from "@/lib/attendance/device-import/contracts";
import { hasPermission } from "@/lib/rbac";
import { getDailyAttendanceFn } from "@/server-functions/hr/attendance/get-daily-attendance-fn";
import { EditAttendanceSheet } from "./edit-attendance-sheet";

const PAGE_SIZE = 50;
const statusLabels: Record<DeviceImportRowStatus, string> = {
  ready: "Ready",
  unchanged: "Already recorded",
  needs_review: "Needs review",
  blocked: "Blocked",
  imported: "Imported",
};
type StatusFilter = "all" | "attention" | DeviceImportRowStatus;
const statusFilterLabels: Record<StatusFilter, string> = {
  all: "All rows",
  attention: "Needs attention",
  ...statusLabels,
};
const importStatusLabels: Record<DeviceImportStatus, string> = {
  preview: "Preview",
  completed: "Import completed",
  undone: "Import undone",
};
const needsAttention = (status: DeviceImportRowStatus) =>
  status === "needs_review" || status === "blocked";

// Device reports use 24-hour "HH:mm"; HR reads 12-hour times.
const formatPunchTime = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return time;
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
};
const formatGapDate = (date: string) => format(parseISO(date), "MMM d");
// Matches the 20:00 night-shift start used by attendance recompute.
const isNightPunch = (time: string) => {
  const hours = Number(time.slice(0, 2));
  return hours >= 20 || hours < 6;
};

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

export function DeviceImportSheet({ open, onOpenChange }: Props) {
  const inputId = useId();
  const { data: viewer } = useViewerAccess();
  const canManage = hasPermission(viewer?.permissions ?? [], "hr.manage");
  const imports = useDeviceAttendanceImports(open && canManage);
  const upload = useUploadDeviceAttendance();
  const refresh = usePreviewDeviceAttendance();
  const confirm = useConfirmDeviceAttendance();
  const undo = useUndoDeviceAttendanceImport();
  const discard = useDiscardDeviceAttendanceImport();
  const unlink = useUnlinkDevicePerson();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DeviceImportPreview | null>(null);
  const [mappings, setMappings] = useState<DeviceImportMappings>({});
  const [previewStale, setPreviewStale] = useState(false);
  const [mappingPersonIds, setMappingPersonIds] = useState<string[]>([]);
  const [lastImportCount, setLastImportCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [reviewTarget, setReviewTarget] = useState<{
    employeeId: string;
    date: string;
  } | null>(null);
  const daily = useQuery({
    queryKey: ["daily-attendance", reviewTarget?.date],
    queryFn: () => getDailyAttendanceFn({ data: { date: reviewTarget!.date } }),
    enabled: Boolean(reviewTarget && open && canManage),
    staleTime: 0,
  });
  const reviewEmployee = daily.data?.find(
    (employee) => employee.id === reviewTarget?.employeeId,
  );
  const editing = Boolean(reviewTarget && reviewEmployee);
  const busy =
    upload.isPending ||
    refresh.isPending ||
    confirm.isPending ||
    undo.isPending ||
    discard.isPending ||
    unlink.isPending ||
    daily.isFetching;

  const displayPreview = (result: DeviceImportPreview) => {
    const unknownIds = result.rows
      .filter((row) => !row.employeeId)
      .map((row) => row.personId);
    setMappingPersonIds((current) => [
      ...new Set(
        result.importId === preview?.importId
          ? [...current, ...unknownIds]
          : unknownIds,
      ),
    ]);
    if (result.importId !== preview?.importId) {
      setSearch("");
      setStatusFilter("all");
      setDateFilter("all");
    }
    setPreview(result);
    setPreviewStale(false);
    setPage(0);
  };

  const handleUpload = async () => {
    if (!file || busy || !canManage) return;
    setError(null);
    if (
      !/\.(csv|xlsx)$/i.test(file.name) ||
      file.size === 0 ||
      file.size > DEVICE_IMPORT_MAX_BYTES
    ) {
      setError("Choose a CSV or Excel report up to 10 MB.");
      return;
    }
    const data = new FormData();
    data.set("file", file);
    try {
      const result = await upload.mutateAsync(data);
      setMappings({});
      setLastImportCount(null);
      setReviewTarget(null);
      displayPreview(result);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to upload attendance report.",
      );
    }
  };

  const handleRefresh = async (
    importId = preview?.importId,
    selections = mappings,
  ) => {
    if (!importId || busy || !canManage) return;
    setError(null);
    try {
      const result = await refresh.mutateAsync({
        importId,
        mappings: selections,
      });
      if (importId !== preview?.importId) {
        setMappings({});
        setLastImportCount(null);
        setReviewTarget(null);
      }
      displayPreview(result);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to preview attendance report.",
      );
    }
  };

  const handleConfirm = async () => {
    if (!preview || busy || previewStale || !canManage) return;
    setError(null);
    try {
      const selection = { importId: preview.importId, mappings };
      const result = await confirm.mutateAsync(selection);
      displayPreview(result);
      setLastImportCount(
        result.rows.reduce((count, row) => count + row.newPunchCount, 0),
      );
      setPreviewStale(true);
      displayPreview(await refresh.mutateAsync(selection));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to import device attendance.",
      );
    }
  };

  const handleUndo = async () => {
    if (!preview || busy || !canManage) return;
    setError(null);
    try {
      await undo.mutateAsync(preview.importId);
      setMappings({});
      setLastImportCount(null);
      setPreviewStale(true);
      displayPreview(
        await refresh.mutateAsync({ importId: preview.importId, mappings: {} }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to undo device import.",
      );
    }
  };

  const handleDiscard = async () => {
    if (!preview || busy || !canManage) return;
    setError(null);
    try {
      await discard.mutateAsync(preview.importId);
      setPreview(null);
      setMappings({});
      setMappingPersonIds([]);
      setLastImportCount(null);
      setPreviewStale(false);
      setReviewTarget(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to discard upload.",
      );
    }
  };

  const handleUnlink = async (personId: string) => {
    if (!preview || busy || !canManage) return;
    setError(null);
    try {
      await unlink.mutateAsync(personId);
      setPreviewStale(true);
      setMappingPersonIds((current) => [...new Set([...current, personId])]);
      displayPreview(
        await refresh.mutateAsync({ importId: preview.importId, mappings }),
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to unlink device Person ID.",
      );
    }
  };

  const rows = preview?.rows ?? [];
  const reviewCount = rows.filter((row) => needsAttention(row.status)).length;
  const newPunchCount = rows.reduce(
    (count, row) => count + (row.status === "blocked" ? 0 : row.newPunchCount),
    0,
  );
  const dates = rows.flatMap((row) => (row.date ? [row.date] : [])).sort();
  const unknownPeople = [
    ...new Map(
      rows
        .filter(
          (row) => !row.employeeId || mappingPersonIds.includes(row.personId),
        )
        .map((row) => [row.personId, row]),
    ).values(),
  ];
  const query = search.trim().toLowerCase();
  const filteredRows = rows.filter(
    (row) =>
      (statusFilter === "all" ||
        (statusFilter === "attention"
          ? needsAttention(row.status)
          : row.status === statusFilter)) &&
      (dateFilter === "all" ||
        row.date === dateFilter ||
        Boolean(row.attendanceDates?.includes(dateFilter))) &&
      (!query ||
        [row.personId, row.personName, row.employeeName].some((value) =>
          value?.toLowerCase().includes(query),
        )),
  );
  const filtersActive =
    Boolean(query) || statusFilter !== "all" || dateFilter !== "all";
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const updateFilter = (apply: () => void) => {
    apply();
    setPage(0);
  };

  return (
    <>
      <ResponsiveSheet
        title="Device attendance import"
        description="Upload the device's Total Punches report, check employee matches, then import the punches."
        open={open && !editing}
        onOpenChange={onOpenChange}
        className="min-w-0 data-[side=right]:w-full data-[side=right]:sm:max-w-6xl"
        bodyClassName="min-h-0 overflow-y-auto"
      >
        {!canManage ? (
          <Alert>
            <AlertTitle>HR management access required</AlertTitle>
            <AlertDescription>
              You need HR management permission to upload and review device
              reports.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="flex flex-col gap-6">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void handleUpload();
              }}
            >
              <FieldGroup>
                <Field data-disabled={busy}>
                  <FieldLabel htmlFor={inputId}>Device report</FieldLabel>
                  <Input
                    id={inputId}
                    type="file"
                    accept=".csv,.xlsx"
                    disabled={busy}
                    onChange={(event) => {
                      setFile(event.target.files?.[0] ?? null);
                      setError(null);
                    }}
                  />
                  <FieldDescription>
                    CSV or Excel, up to 10 MB. Repeated uploads keep existing
                    punches.
                  </FieldDescription>
                </Field>
                <Button
                  type="submit"
                  disabled={!file || busy}
                  className="self-start"
                >
                  {upload.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <HugeiconsIcon
                      icon={FileUploadIcon}
                      data-icon="inline-start"
                    />
                  )}
                  {upload.isPending
                    ? "Uploading report..."
                    : "Upload and preview"}
                </Button>
              </FieldGroup>
            </form>

            {(error || daily.error) && (
              <Alert variant="destructive">
                <AlertTitle>Action failed</AlertTitle>
                <AlertDescription>
                  {error ?? daily.error?.message}
                </AlertDescription>
              </Alert>
            )}
            {reviewTarget &&
              daily.isSuccess &&
              !daily.isFetching &&
              !reviewEmployee && (
                <Alert variant="destructive">
                  <AlertTitle>Employee unavailable for this date</AlertTitle>
                  <AlertDescription>
                    The employee may have joined later or may no longer be
                    active. Review the employee record first.
                  </AlertDescription>
                </Alert>
              )}

            {preview && (
              <section
                className="flex flex-col gap-4"
                aria-label="Report preview"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-semibold">
                      {preview.filename}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {dates.length
                        ? `${dates[0]} to ${dates.at(-1)}`
                        : "No valid report dates"}
                    </p>
                  </div>
                  <Badge variant="outline">
                    {importStatusLabels[preview.status]}
                  </Badge>
                </div>
                <dl className="grid grid-cols-3 gap-3 rounded-lg border bg-muted/20 p-4">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Report rows
                    </dt>
                    <dd className="text-2xl font-semibold tabular-nums">
                      {rows.length}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      New punches
                    </dt>
                    <dd className="text-2xl font-semibold tabular-nums">
                      {newPunchCount}
                    </dd>
                  </div>
                  <div
                    className={
                      reviewCount > 0
                        ? "-m-2 rounded-md bg-amber-500/10 p-2 text-amber-700 dark:text-amber-400"
                        : undefined
                    }
                  >
                    <dt
                      className={
                        reviewCount > 0
                          ? "text-xs"
                          : "text-xs text-muted-foreground"
                      }
                    >
                      Review rows
                    </dt>
                    <dd className="text-2xl font-semibold tabular-nums">
                      {reviewCount}
                    </dd>
                  </div>
                </dl>

                {preview.duplicateOf && (
                  <Alert className="border-amber-500/40 bg-amber-500/10">
                    <AlertTitle className="text-amber-700 dark:text-amber-400">
                      {preview.duplicateOf.status === "completed"
                        ? "This file was already imported"
                        : "This file was uploaded before"}
                    </AlertTitle>
                    <AlertDescription>
                      The same file was uploaded as{" "}
                      {preview.duplicateOf.filename} on{" "}
                      {new Date(preview.duplicateOf.createdAt).toLocaleString(
                        "en-PK",
                      )}{" "}
                      ({importStatusLabels[preview.duplicateOf.status]}).
                      Punches already recorded are never added twice.
                    </AlertDescription>
                  </Alert>
                )}
                {preview.status === "undone" && (
                  <Alert>
                    <AlertTitle>Import undone</AlertTitle>
                    <AlertDescription>
                      Punches from this import were removed. Upload the report
                      again to import it.
                    </AlertDescription>
                  </Alert>
                )}

                {unknownPeople.length > 0 && (
                  <FieldGroup className="rounded-lg border p-4">
                    <div>
                      <h4 className="font-medium">Match device Person IDs</h4>
                      <p className="text-sm text-muted-foreground">
                        Choose the employee for each unknown ID. Refresh the
                        preview to check the match before importing.
                      </p>
                    </div>
                    {unknownPeople.map((person) => (
                      <Field key={person.personId} data-disabled={busy}>
                        <FieldLabel htmlFor={`${inputId}-${person.personId}`}>
                          Person ID {person.personId}
                          {person.personName ? `, ${person.personName}` : ""}
                        </FieldLabel>
                        <Select
                          value={mappings[person.personId] ?? "unmapped"}
                          disabled={busy}
                          onValueChange={(value) => {
                            setMappings((current) => {
                              const next = { ...current };
                              if (value === "unmapped")
                                delete next[person.personId];
                              else next[person.personId] = value;
                              return next;
                            });
                            setPreviewStale(true);
                          }}
                        >
                          <SelectTrigger
                            id={`${inputId}-${person.personId}`}
                            className="w-full"
                          >
                            <SelectValue placeholder="Choose employee" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              <SelectItem value="unmapped">
                                Leave unmatched
                              </SelectItem>
                              {preview.employees.map((employee) => (
                                <SelectItem
                                  key={employee.id}
                                  value={employee.id}
                                >
                                  {employee.employeeCode} · {employee.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                      </Field>
                    ))}
                  </FieldGroup>
                )}

                {preview.savedLinks && preview.savedLinks.length > 0 && (
                  <div className="flex flex-col gap-3 rounded-lg border p-4">
                    <div>
                      <h4 className="font-medium">Saved device links</h4>
                      <p className="text-sm text-muted-foreground">
                        Unlink a wrong match to choose the employee again.
                        Punches already imported stay; undo the import to
                        remove them.
                      </p>
                    </div>
                    <ul className="flex flex-col divide-y">
                      {preview.savedLinks.map((link) => {
                        const employee = preview.employees.find(
                          (e) => e.id === link.employeeId,
                        );
                        return (
                          <li
                            key={link.personId}
                            className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
                          >
                            <span>
                              Person ID {link.personId} ·{" "}
                              {employee
                                ? `${employee.employeeCode} · ${employee.name}`
                                : "Employee unavailable"}
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={busy}
                              aria-label={`Unlink Person ID ${link.personId}`}
                              onClick={() => void handleUnlink(link.personId)}
                            >
                              Unlink
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                {preview.cycleGaps?.map((gap) => (
                  <Alert
                    key={gap.startDate}
                    className="border-amber-500/40 bg-amber-500/10"
                  >
                    <AlertTitle className="text-amber-700 dark:text-amber-400">
                      {gap.label} payroll month is incomplete
                    </AlertTitle>
                    <AlertDescription>
                      <p>
                        The payroll month runs {gap.range}. No attendance is
                        recorded for {gap.missingDayCount}{" "}
                        {gap.missingDayCount === 1 ? "day" : "days"}:{" "}
                        {gap.missingRanges
                          .map(({ start, end }) =>
                            start === end
                              ? formatGapDate(start)
                              : `${formatGapDate(start)} – ${formatGapDate(end)}`,
                          )
                          .join(", ")}
                        .
                      </p>
                      <p>
                        You can still import this report. Upload the device
                        report for the missing dates, or mark them in
                        Attendance Management, before running payroll.
                      </p>
                    </AlertDescription>
                  </Alert>
                ))}
                {reviewCount > 0 && (
                  <Alert className="border-amber-500/40 bg-amber-500/10">
                    <AlertTitle className="text-amber-700 dark:text-amber-400">
                      {reviewCount} rows need HR review
                    </AlertTitle>
                    <AlertDescription>
                      Rows with valid new punches can import even when a
                      checkout is missing. Correct flagged days in Attendance
                      Management before payroll. Blocked rows stay unchanged.
                      {statusFilter !== "attention" && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-2"
                          onClick={() =>
                            updateFilter(() => setStatusFilter("attention"))
                          }
                        >
                          Show only rows needing attention
                        </Button>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                {lastImportCount !== null && (
                  <Alert>
                    <AlertTitle>Import saved</AlertTitle>
                    <AlertDescription>
                      {lastImportCount} punches imported. The preview shows the
                      latest remaining work. Review flagged days before payroll.
                    </AlertDescription>
                  </Alert>
                )}
                {previewStale && (
                  <Alert>
                    <AlertTitle>Refresh required</AlertTitle>
                    <AlertDescription>
                      Refresh the preview to check employee matches and
                      remaining punches before importing.
                    </AlertDescription>
                  </Alert>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void handleRefresh()}
                  >
                    {refresh.isPending && <Spinner data-icon="inline-start" />}
                    Refresh preview
                  </Button>
                  <Button
                    type="button"
                    disabled={
                      busy ||
                      previewStale ||
                      newPunchCount === 0 ||
                      preview.status === "undone"
                    }
                    onClick={() => void handleConfirm()}
                  >
                    {confirm.isPending && <Spinner data-icon="inline-start" />}
                    {confirm.isPending
                      ? "Importing punches..."
                      : `Import ${newPunchCount} new punches`}
                  </Button>
                  {preview.status === "completed" && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          type="button"
                          variant="destructive"
                          disabled={busy}
                        >
                          {undo.isPending && (
                            <Spinner data-icon="inline-start" />
                          )}
                          Undo import
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Undo this import?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Every punch this import added is removed and the
                            affected days are recalculated. Punches HR corrected
                            since are kept. Draft payrolls for these dates will
                            need regenerating. This cannot be reversed; upload
                            the report again to re-import.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => void handleUndo()}
                          >
                            Undo import
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                  {preview.status === "preview" && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" variant="ghost" disabled={busy}>
                          {discard.isPending && (
                            <Spinner data-icon="inline-start" />
                          )}
                          Discard upload
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Discard this upload?</AlertDialogTitle>
                          <AlertDialogDescription>
                            The uploaded report is deleted. No attendance was
                            imported from it, so nothing else changes.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => void handleDiscard()}
                          >
                            Discard upload
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
                  <Field>
                    <FieldLabel htmlFor={`${inputId}-search`}>
                      Search rows
                    </FieldLabel>
                    <Input
                      id={`${inputId}-search`}
                      type="search"
                      placeholder="Person ID or name"
                      value={search}
                      onChange={(event) =>
                        updateFilter(() => setSearch(event.target.value))
                      }
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${inputId}-status`}>Status</FieldLabel>
                    <Select
                      value={statusFilter}
                      onValueChange={(value) =>
                        updateFilter(() =>
                          setStatusFilter(value as StatusFilter),
                        )
                      }
                    >
                      <SelectTrigger
                        id={`${inputId}-status`}
                        className="w-full sm:w-44"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          {(
                            Object.keys(statusFilterLabels) as StatusFilter[]
                          ).map((status) => (
                            <SelectItem key={status} value={status}>
                              {statusFilterLabels[status]}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor={`${inputId}-date`}>Date</FieldLabel>
                    <Select
                      value={dateFilter}
                      onValueChange={(value) =>
                        updateFilter(() => setDateFilter(value))
                      }
                    >
                      <SelectTrigger
                        id={`${inputId}-date`}
                        className="w-full sm:w-40"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="all">All dates</SelectItem>
                          {[...new Set(dates)].map((date) => (
                            <SelectItem key={date} value={date}>
                              {date}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={!filtersActive}
                    onClick={() =>
                      updateFilter(() => {
                        setSearch("");
                        setStatusFilter("all");
                        setDateFilter("all");
                      })
                    }
                  >
                    Clear filters
                  </Button>
                </div>
                {filtersActive && (
                  <p className="text-sm text-muted-foreground">
                    Showing {filteredRows.length} of {rows.length} rows
                  </p>
                )}
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Row / Person</TableHead>
                        <TableHead>Date / Punches</TableHead>
                        <TableHead>Result</TableHead>
                        <TableHead>Duty</TableHead>
                        <TableHead>Review</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredRows.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={5}
                            className="py-8 text-center text-muted-foreground"
                          >
                            No rows match these filters.
                          </TableCell>
                        </TableRow>
                      )}
                      {filteredRows
                        .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                        .map((row) => (
                          <TableRow
                            key={row.rowNumber}
                            data-status={row.status}
                            className={
                              row.status === "needs_review"
                                ? "border-l-4 border-l-amber-500 bg-amber-500/10 hover:bg-amber-500/15"
                                : row.status === "blocked"
                                  ? "border-l-4 border-l-destructive bg-destructive/10 hover:bg-destructive/15"
                                  : undefined
                            }
                          >
                            <TableCell>
                              <p>
                                #{row.rowNumber} · {row.personId}
                              </p>
                              <p className="text-muted-foreground">
                                {row.employeeName ??
                                  row.personName ??
                                  "Unmatched employee"}
                              </p>
                            </TableCell>
                            <TableCell>
                              <p>{row.date ?? "Missing date"}</p>
                              {row.punchTimes.length === 0 ? (
                                <p className="text-muted-foreground">
                                  No punches
                                </p>
                              ) : (
                                <ul className="flex flex-col gap-0.5 text-muted-foreground">
                                  {(
                                    row.punchDetails ??
                                    row.punchTimes.map((time) => ({
                                      time,
                                      direction: null,
                                      attendanceDate: null,
                                    }))
                                  ).map((punch, index) => (
                                    <li key={`${punch.time}-${index}`}>
                                      <span className="tabular-nums text-foreground">
                                        {formatPunchTime(punch.time)}
                                      </span>
                                      {punch.direction &&
                                        ` · ${punch.direction.toUpperCase()}`}
                                      {isNightPunch(punch.time) && " · Night"}
                                      {punch.attendanceDate &&
                                        punch.attendanceDate !== row.date && (
                                          <span className="text-amber-700 dark:text-amber-400">
                                            {` · counted on ${punch.attendanceDate}`}
                                          </span>
                                        )}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </TableCell>
                            <TableCell className="max-w-80 whitespace-normal">
                              <Badge
                                variant={
                                  row.status === "blocked"
                                    ? "destructive"
                                    : row.status === "needs_review"
                                      ? "outline"
                                      : "secondary"
                                }
                                className={
                                  row.status === "needs_review"
                                    ? "border-amber-500/50 bg-amber-500/20 font-semibold text-amber-700 dark:text-amber-400"
                                    : undefined
                                }
                              >
                                {statusLabels[row.status]}
                              </Badge>
                              {row.newPunchCount > 0 && (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {row.newPunchCount} new punches
                                </p>
                              )}
                              {row.messages.map((message, index) => (
                                <p
                                  key={index}
                                  className={
                                    row.status === "needs_review"
                                      ? "mt-1 text-xs font-medium text-amber-700 dark:text-amber-400"
                                      : row.status === "blocked"
                                        ? "mt-1 text-xs font-medium text-destructive"
                                        : "mt-1 text-xs text-muted-foreground"
                                  }
                                >
                                  {message}
                                </p>
                              ))}
                            </TableCell>
                            <TableCell className="tabular-nums">
                              {row.dutyHours == null
                                ? "—"
                                : `${row.dutyHours}h`}
                            </TableCell>
                            <TableCell>
                              {(row.attendanceDates?.length
                                ? row.attendanceDates
                                : [row.date]
                              ).map((date) => (
                                <Button
                                  key={date ?? "unknown"}
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  disabled={busy || !row.employeeId || !date}
                                  aria-label={`Review attendance row ${row.rowNumber}${row.attendanceDates && row.attendanceDates.length > 1 ? ` on ${date}` : ""}`}
                                  onClick={() => {
                                    setError(null);
                                    setReviewTarget({
                                      employeeId: row.employeeId!,
                                      date: date!,
                                    });
                                  }}
                                >
                                  {row.attendanceDates &&
                                  (row.attendanceDates.length > 1 ||
                                    date !== row.date)
                                    ? `Review ${date}`
                                    : "Review day"}
                                </Button>
                              ))}
                              {row.employeeId && row.date && (
                                <Button
                                  asChild
                                  variant="link"
                                  size="sm"
                                  className="px-0"
                                >
                                  <Link
                                    to="/hr/attendance/$employeeId"
                                    params={{ employeeId: row.employeeId }}
                                    search={{
                                      from: format(
                                        startOfMonth(parseISO(row.date)),
                                        "yyyy-MM-dd",
                                      ),
                                      to: format(
                                        endOfMonth(parseISO(row.date)),
                                        "yyyy-MM-dd",
                                      ),
                                    }}
                                    aria-label={`Open ${row.employeeName ?? row.personId}'s month`}
                                  >
                                    Employee month
                                  </Link>
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
                {pageCount > 1 && (
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm text-muted-foreground">
                      Page {page + 1} of {pageCount}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={page === 0 || busy}
                        onClick={() => setPage((current) => current - 1)}
                      >
                        Previous rows
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={page + 1 >= pageCount || busy}
                        onClick={() => setPage((current) => current + 1)}
                      >
                        Next rows
                      </Button>
                    </div>
                  </div>
                )}
              </section>
            )}

            <Separator />
            <section
              className="flex flex-col gap-3"
              aria-label="Recent device uploads"
            >
              <h3 className="font-semibold">Recent uploads</h3>
              {imports.isLoading ? (
                <Skeleton className="h-20" />
              ) : imports.isError ? (
                <Alert variant="destructive">
                  <AlertTitle>Unable to load recent uploads</AlertTitle>
                  <AlertDescription>
                    {imports.error.message}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void imports.refetch()}
                    >
                      Retry
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : imports.data?.length ? (
                <div className="flex flex-col divide-y rounded-lg border">
                  {imports.data.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {item.filename}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(item.createdAt).toLocaleString("en-PK")} ·{" "}
                          {item.totalRows} rows · {item.reviewRows} review rows
                          {item.status === "undone" && " · Undone"}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        aria-label={`Open upload ${item.filename}`}
                        onClick={() => {
                          void handleRefresh(item.id, {});
                        }}
                      >
                        {item.status === "preview"
                          ? "Open preview"
                          : "Review import"}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty className="border p-5">
                  <EmptyHeader>
                    <EmptyTitle>No device uploads yet</EmptyTitle>
                    <EmptyDescription>
                      Uploaded reports remain here for later review.
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </section>
          </div>
        )}
      </ResponsiveSheet>
      {editing && reviewEmployee && reviewTarget && (
        <EditAttendanceSheet
          open={open}
          onOpenChange={(next) => {
            if (!next) {
              setReviewTarget(null);
              void handleRefresh();
            }
          }}
          employee={reviewEmployee}
          attendance={
            reviewEmployee.attendance[0] as ComponentProps<
              typeof EditAttendanceSheet
            >["attendance"]
          }
          date={reviewTarget.date}
        />
      )}
    </>
  );
}
