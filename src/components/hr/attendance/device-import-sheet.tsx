import { useId, useState, type ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { HugeiconsIcon } from "@hugeicons/react";
import { FileUploadIcon } from "@hugeicons/core-free-icons";
import { ResponsiveSheet } from "@/components/custom/responsive-sheet";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  usePreviewDeviceAttendance,
  useUploadDeviceAttendance,
} from "@/hooks/hr/use-device-attendance";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import {
  DEVICE_IMPORT_MAX_BYTES,
  type DeviceImportMappings,
  type DeviceImportPreview,
  type DeviceImportRowStatus,
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

type Props = { open: boolean; onOpenChange: (open: boolean) => void };

export function DeviceImportSheet({ open, onOpenChange }: Props) {
  const inputId = useId();
  const { data: viewer } = useViewerAccess();
  const canManage = hasPermission(viewer?.permissions ?? [], "hr.manage");
  const imports = useDeviceAttendanceImports(open && canManage);
  const upload = useUploadDeviceAttendance();
  const refresh = usePreviewDeviceAttendance();
  const confirm = useConfirmDeviceAttendance();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DeviceImportPreview | null>(null);
  const [mappings, setMappings] = useState<DeviceImportMappings>({});
  const [previewStale, setPreviewStale] = useState(false);
  const [mappingPersonIds, setMappingPersonIds] = useState<string[]>([]);
  const [lastImportCount, setLastImportCount] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
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

  const rows = preview?.rows ?? [];
  const reviewCount = rows.filter(
    (row) => row.status === "needs_review" || row.status === "blocked",
  ).length;
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
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

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
                    {preview.status === "completed"
                      ? "Import completed"
                      : "Preview"}
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
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      Review rows
                    </dt>
                    <dd className="text-2xl font-semibold tabular-nums">
                      {reviewCount}
                    </dd>
                  </div>
                </dl>

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

                {reviewCount > 0 && (
                  <Alert>
                    <AlertTitle>{reviewCount} rows need HR review</AlertTitle>
                    <AlertDescription>
                      Rows with valid new punches can import even when a
                      checkout is missing. Correct flagged days in Attendance
                      Management before payroll. Blocked rows stay unchanged.
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
                    disabled={busy || previewStale || newPunchCount === 0}
                    onClick={() => void handleConfirm()}
                  >
                    {confirm.isPending && <Spinner data-icon="inline-start" />}
                    {confirm.isPending
                      ? "Importing punches..."
                      : `Import ${newPunchCount} new punches`}
                  </Button>
                </div>
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
                      {rows
                        .slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
                        .map((row) => (
                          <TableRow key={row.rowNumber}>
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
                              <p className="text-muted-foreground">
                                {row.punchTimes.join(", ") || "No punches"}
                              </p>
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
                                  className="mt-1 text-xs text-muted-foreground"
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
                        {item.status === "completed"
                          ? "Review import"
                          : "Open preview"}
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
