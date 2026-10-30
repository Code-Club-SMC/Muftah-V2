import { useEffect, useRef, useState } from "react";
import Big from "big.js";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import {
  useBatchPacking,
  useRecordBatchPacking,
  useRefreshBatchPacking,
} from "@/hooks/manufacturing/packaging/use-batch-packing";
import { getBatchPackingRequestFn } from "@/server-functions/manufacturing/packaging/get-batch-packing-context-fn";
import { calculatePackingLine, packingMaterialNeeds } from "@/lib/production/batch-packing";
import { LotPicker, lotPicksValid } from "@/components/inventory/lot-picker";
import { useMaterialLots } from "@/hooks/stock/use-material-lots";
import type { LotPick } from "@/lib/inventory/material-lots";
import { PackingFormatRow } from "./packing-format-row";
import {
  emptyPackingLine,
  newPackingDraft,
  packingDraftSchema,
  packingLineInput,
  type PackingDraft,
} from "./packing-draft";

type PackingContext = NonNullable<ReturnType<typeof useBatchPacking>["data"]>;

// Packaging the counted lines take. Lines with count errors are left out; they show their own error.
function materialNeedsFor(data: PackingContext, lines: PackingDraft["lines"]) {
  const items = lines.flatMap((line) => {
    const format = data.formats.find((item) => item.id === line.recipeId);
    const materials = data.formatMaterials.find((item) => item.formatId === line.recipeId);
    if (!format || !materials) return [];
    try {
      const result = calculatePackingLine(packingLineInput(line), format, data.batch.bulkUnit);
      return [{ ...materials, totalPacks: result.totalPacks, physicalCartons: result.physicalCartons }];
    } catch {
      return [];
    }
  });
  try {
    return { needs: packingMaterialNeeds(items, data.extras), error: "" };
  } catch (caught) {
    return { needs: new Map<string, { total: Big }>(), error: caught instanceof Error ? caught.message : "Check the packing formats." };
  }
}

export function BatchPackingForm({ mixingRunId }: { mixingRunId: string }) {
  const query = useBatchPacking(mixingRunId);
  const viewer = useViewerAccess();
  if (query.isPending || viewer.isPending)
    return (
      <div aria-label="Loading batch packing" className="grid gap-4">
        <Skeleton className="h-28 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  if (query.error || viewer.error)
    return (
      <Alert variant="destructive">
        <AlertTitle>Unable to load packing</AlertTitle>
        <AlertDescription>
          {query.error?.message || viewer.error?.message}
          <Button
            variant="outline"
            onClick={() => {
              void query.refetch();
              void viewer.refetch();
            }}
          >
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  if (!query.data || !viewer.data) return null;
  return (
    <BatchPackingEditor
      key={`${viewer.data.user.id}:${mixingRunId}`}
      data={query.data}
      actorId={viewer.data.user.id}
      refresh={() => query.refetch()}
    />
  );
}

export function BatchPackingEditor({
  data,
  actorId,
  refresh,
}: {
  data: PackingContext;
  actorId: string;
  refresh: () => Promise<unknown>;
}) {
  const { batch, formats, receipts } = data;
  const storageKey = `titan:batch-packing:v1:${actorId}:${batch.id}`;
  const [draft, setDraft] = useState<PackingDraft | null>(null);
  const [review, setReview] = useState(false);
  const [message, setMessage] = useState("");
  const [storageError, setStorageError] = useState("");
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState(false);
  const reviewRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const mutation = useRecordBatchPacking();
  const refreshStock = useRefreshBatchPacking();
  const { needs, error: materialsError } = materialNeedsFor(data, draft?.lines ?? []);
  const lots = useMaterialLots(data.warehouseId, "packaging", [...needs.keys()]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = packingDraftSchema.safeParse(JSON.parse(stored));
        if (!parsed.success)
          throw new Error(
            "The saved draft could not be restored. Check your counts before continuing.",
          );
        setDraft(parsed.data);
        setReview(!!parsed.data.submitted);
      } else setDraft(newPackingDraft());
    } catch (caught) {
      setMessage(
        caught instanceof Error
          ? caught.message
          : "Unable to restore this draft.",
      );
      setDraft(newPackingDraft());
    }
  }, [storageKey]);

  useEffect(() => {
    if (!draft) return;
    try {
      if (draft.lines.length || draft.submitted)
        localStorage.setItem(storageKey, JSON.stringify(draft));
      else localStorage.removeItem(storageKey);
      setStorageError("");
    } catch {
      setStorageError(
        "This browser cannot save your draft. Allow browser storage before confirming packing.",
      );
    }
  }, [draft, storageKey]);

  useEffect(() => {
    if (
      draft?.submitted &&
      receipts.some(
        (receipt) => receipt.requestId === draft.submitted?.requestId,
      )
    ) {
      setDraft(newPackingDraft());
      setReview(false);
      setMessage("");
      setSaved(true);
      void refreshStock(batch.id);
    }
  }, [draft?.submitted, receipts, refreshStock, batch.id]);

  useEffect(() => {
    if (review) reviewRef.current?.focus();
  }, [review]);
  useEffect(() => {
    if (message) errorRef.current?.focus();
  }, [message]);

  if (!draft) return <Skeleton className="h-64 w-full" />;

  const locked = mutation.isPending || !!draft.submitted || checking;
  const editingDisabled = locked || !batch.canRecord;
  const updateDraft = (change: Partial<PackingDraft>) => {
    setDraft({ ...draft, ...change });
    setReview(false);
    setMessage("");
    setSaved(false);
  };
  const calculated = draft.lines.map((line) => {
    const format = formats.find((item) => item.id === line.recipeId);
    try {
      if (!format)
        throw new Error(
          "This format is no longer available. Remove it and choose an active format.",
        );
      const input = packingLineInput(line);
      return {
        line,
        format,
        input,
        result: calculatePackingLine(input, format, batch.bulkUnit),
        error: "",
      };
    } catch (caught) {
      return {
        line,
        format,
        error:
          caught instanceof Error ? caught.message : "Check the pack counts.",
      };
    }
  });
  const bulk = calculated.reduce(
    (sum, row) => sum.plus(row.result?.actualBulk ?? 0),
    new Big(0),
  );
  const packs = calculated.reduce(
    (sum, row) => sum + (row.result?.totalPacks ?? 0),
    0,
  );
  const loose = calculated.reduce(
    (sum, row) => sum + (row.input?.loosePacks ?? 0),
    0,
  );
  const cartons = calculated.reduce(
    (sum, row) => sum + (row.result?.physicalCartons ?? 0),
    0,
  );
  let loss = new Big(0);
  let lossError = "";
  try {
    if (draft.lossBulk && !/^\d+(\.\d{1,3})?$/.test(draft.lossBulk))
      throw new Error("Enter zero or more, with up to 3 decimal places.");
    loss = new Big(draft.lossBulk || 0);
    if (loss.gt(0) && !draft.lossReason.trim())
      lossError = "Enter a reason for the loss.";
  } catch {
    lossError = "Enter zero or more, with up to 3 decimal places.";
  }
  const remaining = new Big(batch.availableBulk).minus(bulk).minus(loss);
  const overdrawn = remaining.lt(0);
  const packingDate = new Date(draft.packedAt);
  const dateValid =
    Number.isFinite(packingDate.getTime()) &&
    packingDate.getTime() <= Date.now() + 60_000;
  const localPackingTime = Number.isFinite(packingDate.getTime())
    ? new Date(packingDate.getTime() - packingDate.getTimezoneOffset() * 60_000)
        .toISOString()
        .slice(0, 16)
    : "";
  const needed = [...needs].map(([materialId, need]) => ({
    materialId,
    name: data.materials.find((item) => item.id === materialId)?.name ?? "Packaging material",
    required: need.total.toString(),
    picks: draft.lotPicks[materialId] ?? [],
    lots: lots.data?.[materialId] ?? [],
  }));
  const setLotPicks = (materialId: string, picks: LotPick[]) =>
    setDraft((current) => current && { ...current, lotPicks: { ...current.lotPicks, [materialId]: picks } });
  const lotsValid =
    !materialsError &&
    (needed.length === 0 || !!lots.data) &&
    needed.every((item) => lotPicksValid(item.required, item.picks, item.lots, item.name, "pcs", true));
  const valid =
    dateValid &&
    draft.lines.length > 0 &&
    calculated.every((row) => !!row.result) &&
    lotsValid &&
    !lossError &&
    !overdrawn &&
    packs > 0;
  const amount = (value: Big | string) =>
    `${new Big(value).toString()} ${batch.bulkUnit}`;

  async function confirm() {
    if (!draft || mutation.isPending || (!draft.submitted && !valid)) return;
    const submission = draft.submitted ?? {
      mixingRunId: batch.id,
      requestId: draft.requestId,
      packedAt: draft.packedAt,
      lines: draft.lines.map(packingLineInput),
      lossBulk: loss.toFixed(3),
      ...(draft.lossReason.trim()
        ? { lossReason: draft.lossReason.trim() }
        : {}),
      lotPicks: needed.map((item) => ({
        materialId: item.materialId,
        picks: item.picks.filter((pick) => pick.quantity !== ""),
      })),
    };
    const next = { ...draft, submitted: submission };
    // Persist before sending so a refresh after a lost response retries the same receipt.
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
    } catch {
      setStorageError(
        "This browser cannot save your draft. Allow browser storage before confirming packing.",
      );
      return;
    }
    setDraft(next);
    setMessage("");
    mutation.mutate(
      { data: submission },
      {
        onSuccess: () => {
          setDraft(newPackingDraft());
          setReview(false);
          setSaved(true);
          setMessage("");
          toast.success("Packing saved. Finished goods updated.");
        },
        onError: (error) =>
          setMessage(
            error.message ||
              "The response was interrupted. Retry to check whether packing was saved.",
          ),
      },
    );
  }

  async function checkBeforeEditing() {
    if (!draft?.submitted) return;
    setChecking(true);
    try {
      const result = await getBatchPackingRequestFn({
        data: { mixingRunId: batch.id, requestId: draft.submitted.requestId },
      });
      if (result.status === "posted") {
        await refreshStock(batch.id);
        setDraft(newPackingDraft());
        setReview(false);
        setSaved(true);
        setMessage("");
      } else {
        setDraft({ ...draft, submitted: undefined });
        setReview(false);
        setMessage("");
        await refresh();
      }
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to check. Your original submission is still saved for retry.",
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <section aria-label="Batch packing" className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">Batch {batch.batchId}</Badge>
            <Badge variant="secondary">Mixing complete</Badge>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">
            Record packing
          </h2>
          <p className="max-w-xl text-sm text-muted-foreground">
            {batch.formulaName}. Enter what has already been packed on the
            factory floor.
          </p>
        </div>
        {draft.lines.length > 0 && !storageError && (
          <p role="status" className="text-sm text-muted-foreground">
            {draft.submitted
              ? "Submission saved for safe retry"
              : "Draft saved on this device"}
          </p>
        )}
      </header>

      <dl className="grid grid-cols-2 gap-4 rounded-xl border bg-muted/30 p-5 sm:grid-cols-3">
        <div>
          <dt className="text-sm text-muted-foreground">Batch produced</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">
            {amount(batch.producedBulk)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Available to pack</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">
            {amount(batch.availableBulk)}
          </dd>
        </div>
        <div>
          <dt className="text-sm text-muted-foreground">Formats available</dt>
          <dd className="mt-1 text-xl font-semibold tabular-nums">
            {formats.length}
          </dd>
        </div>
      </dl>

      {saved && (
        <Alert>
          <AlertTitle>Packing saved</AlertTitle>
          <AlertDescription>
            The finished goods are now on the factory floor. You can record
            another split if powder or liquid remains.
          </AlertDescription>
        </Alert>
      )}
      {data.legacyOpenJobs > 0 && (
        <Alert>
          <AlertTitle>Some bulk is reserved</AlertTitle>
          <AlertDescription>
            {data.legacyOpenJobs} existing packing job(s) still hold bulk. The
            available amount above excludes that stock. Complete or cancel those
            jobs before recording the same output here.
          </AlertDescription>
        </Alert>
      )}
      {!batch.canRecord && (
        <Alert>
          <AlertTitle>Viewing packing records</AlertTitle>
          <AlertDescription>
            You can view this batch. An authorized operator or production
            manager can record its packing.
          </AlertDescription>
        </Alert>
      )}
      {storageError && (
        <Alert variant="destructive">
          <AlertTitle>Draft storage unavailable</AlertTitle>
          <AlertDescription>{storageError}</AlertDescription>
        </Alert>
      )}
      {message && (
        <div ref={errorRef} tabIndex={-1}>
          <Alert variant="destructive">
            <AlertTitle>Packing needs attention</AlertTitle>
            <AlertDescription className="whitespace-pre-line">
              {message}
            </AlertDescription>
          </Alert>
        </div>
      )}

      {batch.canRecord && draft.lines.length > 0 && !review && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 border bg-background p-3 shadow-sm xl:hidden">
          <p className="text-sm" aria-live="polite">
            {overdrawn ? "Over available" : "Left to pack"}:{" "}
            <strong className="tabular-nums">{amount(remaining.abs())}</strong>
          </p>
          <Button
            type="button"
            className="min-h-11"
            disabled={!valid || editingDisabled || !!storageError}
            onClick={() => setReview(true)}
          >
            Review
          </Button>
        </div>
      )}

      {(batch.canRecord || draft.lines.length > 0) && (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) setReview(true);
          }}
          className="grid min-w-0 items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]"
        >
          <div className="flex min-w-0 flex-col gap-4">
            {draft.lines.map((line, index) => {
              const format = formats.find((item) => item.id === line.recipeId);
              return format ? (
                <PackingFormatRow
                  key={line.recipeId}
                  line={line}
                  format={format}
                  bulkUnit={batch.bulkUnit}
                  index={index}
                  disabled={editingDisabled || review}
                  onChange={(changed) =>
                    updateDraft({
                      lines: draft.lines.map((item, at) =>
                        at === index ? changed : item,
                      ),
                    })
                  }
                  onRemove={() =>
                    updateDraft({
                      lines: draft.lines.filter((_, at) => at !== index),
                    })
                  }
                />
              ) : (
                <Alert key={line.recipeId} variant="destructive">
                  <AlertTitle>Format no longer available</AlertTitle>
                  <AlertDescription>
                    Remove this saved line and choose an active format.
                    <Button
                      type="button"
                      disabled={editingDisabled}
                      variant="outline"
                      onClick={() =>
                        updateDraft({
                          lines: draft.lines.filter((_, at) => at !== index),
                        })
                      }
                    >
                      Remove unavailable format
                    </Button>
                  </AlertDescription>
                </Alert>
              );
            })}
            {!review &&
              (formats.length === 0 ||
                formats.some(
                  (format) =>
                    !draft.lines.some((line) => line.recipeId === format.id),
                )) && (
                <Card>
                  <CardHeader>
                    <CardTitle>
                      {draft.lines.length
                        ? "Add another format"
                        : "Choose a pack format"}
                    </CardTitle>
                    <CardDescription>
                      Only formats saved for this batch's formula appear here.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FieldGroup>
                      <Field>
                        <FieldLabel htmlFor={`add-format-${batch.id}`}>
                          Pack format
                        </FieldLabel>
                        <NativeSelect
                          id={`add-format-${batch.id}`}
                          value=""
                          className="w-full [&_select]:h-12"
                          disabled={
                            editingDisabled ||
                            formats.every((format) =>
                              draft.lines.some(
                                (line) => line.recipeId === format.id,
                              ),
                            )
                          }
                          onChange={(event) => {
                            if (event.target.value)
                              updateDraft({
                                lines: [
                                  ...draft.lines,
                                  emptyPackingLine(event.target.value),
                                ],
                              });
                          }}
                        >
                          <NativeSelectOption value="">
                            Select a format to add
                          </NativeSelectOption>
                          {formats
                            .filter(
                              (format) =>
                                !draft.lines.some(
                                  (line) => line.recipeId === format.id,
                                ),
                            )
                            .map((format) => (
                              <NativeSelectOption
                                key={format.id}
                                value={format.id}
                              >
                                {format.name} · {format.fillAmount}{" "}
                                {format.fillUnit}
                              </NativeSelectOption>
                            ))}
                        </NativeSelect>
                        <FieldDescription>
                          {formats.length === 0
                            ? "No active formats are set up. Ask a production manager to add a format for this formula."
                            : "Pack weight and carton size are filled in for you."}
                        </FieldDescription>
                      </Field>
                    </FieldGroup>
                  </CardContent>
                </Card>
              )}
            {!review && !draft.submitted && (materialsError || needed.length > 0) && (
              <Card>
                <CardHeader>
                  <CardTitle>Materials used</CardTitle>
                  <CardDescription>
                    Stock is taken from the oldest lot first.
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  {materialsError ? (
                    <p className="text-sm text-destructive">{materialsError}</p>
                  ) : lots.error ? (
                    <p className="text-sm text-destructive">{lots.error.message}</p>
                  ) : !lots.data ? (
                    <Skeleton className="h-24 w-full" />
                  ) : (
                    needed.map((item) => (
                      <LotPicker
                        oldestFirst
                        key={item.materialId}
                        name={item.name}
                        unit="pcs"
                        required={item.required}
                        lots={item.lots}
                        value={item.picks}
                        onChange={(picks) => setLotPicks(item.materialId, picks)}
                      />
                    ))
                  )}
                </CardContent>
              </Card>
            )}
            <details className="rounded-xl border p-5">
              <summary className="cursor-pointer py-1 text-sm font-medium focus-visible:outline-2">
                Packing time
              </summary>
              <FieldGroup className="pt-5">
                <Field data-invalid={!dateValid}>
                  <FieldLabel htmlFor={`packing-time-${batch.id}`}>
                    When was this packed?
                  </FieldLabel>
                  <Input
                    id={`packing-time-${batch.id}`}
                    type="datetime-local"
                    className="h-12"
                    value={localPackingTime}
                    disabled={editingDisabled || review}
                    aria-invalid={!dateValid}
                    aria-describedby={`packing-time-help-${batch.id}`}
                    onChange={(event) => {
                      const date = new Date(event.target.value);
                      updateDraft({
                        packedAt: Number.isFinite(date.getTime())
                          ? date.toISOString()
                          : "",
                      });
                    }}
                  />
                  <FieldDescription id={`packing-time-help-${batch.id}`}>
                    Your local time. Use the time packing happened; future times
                    are not allowed.
                  </FieldDescription>
                  {!dateValid && (
                    <FieldError>
                      Enter a valid packing time in the past or present.
                    </FieldError>
                  )}
                </Field>
              </FieldGroup>
            </details>
            <details
              className="rounded-xl border p-5"
              open={draft.lossBulk ? true : undefined}
            >
              <summary className="cursor-pointer py-1 text-sm font-medium focus-visible:outline-2">
                Record a spill or packing loss
              </summary>
              <FieldGroup className="pt-5">
                <Field data-invalid={!!lossError}>
                  <FieldLabel htmlFor={`loss-${batch.id}`}>
                    Powder or liquid lost ({batch.bulkUnit})
                  </FieldLabel>
                  <Input
                    id={`loss-${batch.id}`}
                    inputMode="decimal"
                    value={draft.lossBulk}
                    disabled={editingDisabled || review}
                    className="h-12"
                    placeholder="0"
                    aria-invalid={!!lossError}
                    aria-describedby={
                      lossError ? `loss-error-${batch.id}` : undefined
                    }
                    onChange={(event) =>
                      updateDraft({ lossBulk: event.target.value })
                    }
                  />
                  <FieldDescription>
                    Unused powder stays available. Enter only actual loss here.
                  </FieldDescription>
                </Field>
                <Field data-invalid={!!lossError}>
                  <FieldLabel htmlFor={`loss-reason-${batch.id}`}>
                    Reason for loss
                  </FieldLabel>
                  <Input
                    id={`loss-reason-${batch.id}`}
                    value={draft.lossReason}
                    maxLength={500}
                    disabled={editingDisabled || review}
                    onChange={(event) =>
                      updateDraft({ lossReason: event.target.value })
                    }
                    aria-invalid={!!lossError}
                    aria-describedby={
                      lossError ? `loss-error-${batch.id}` : undefined
                    }
                  />
                </Field>
                {lossError && (
                  <FieldError id={`loss-error-${batch.id}`}>
                    {lossError}
                  </FieldError>
                )}
              </FieldGroup>
            </details>
          </div>

          <Card className="xl:sticky xl:top-6">
            <CardHeader>
              <CardTitle>Weight check</CardTitle>
              <CardDescription>
                Every amount stays accounted for.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm tabular-nums">
                <dt className="text-muted-foreground">Available</dt>
                <dd className="text-right">{amount(batch.availableBulk)}</dd>
                <dt className="text-muted-foreground">Used in packs</dt>
                <dd className="text-right">{amount(bulk)}</dd>
                <dt className="text-muted-foreground">Packing loss</dt>
                <dd className="text-right">{amount(loss)}</dd>
              </dl>
              <Separator />
              <div aria-live="polite" aria-atomic="true">
                <p className="text-sm text-muted-foreground">
                  {overdrawn ? "Over available amount" : "Left to pack"}
                </p>
                <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
                  {amount(remaining.abs())}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {overdrawn
                    ? "Reduce the counts or check the measured weight."
                    : remaining.eq(0) && valid
                      ? "All available bulk is accounted for."
                      : "This amount stays available on the batch."}
                </p>
              </div>
              {overdrawn && (
                <Alert variant="destructive">
                  <AlertDescription>
                    Your entries exceed the available bulk by{" "}
                    {amount(remaining.abs())}.
                  </AlertDescription>
                </Alert>
              )}
              <Separator />
              <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm tabular-nums">
                <dt className="text-muted-foreground">Total packs</dt>
                <dd className="text-right font-semibold">
                  {packs.toLocaleString()}
                </dd>
                <dt className="text-muted-foreground">Physical cartons</dt>
                <dd className="text-right">{cartons.toLocaleString()}</dd>
                <dt className="text-muted-foreground">Loose packs</dt>
                <dd className="text-right">{loose.toLocaleString()}</dd>
              </dl>
              {draft.lines.length > 0 && !valid && !overdrawn && (
                <p className="text-sm text-muted-foreground">
                  Enter a positive pack count for every format and check any
                  messages above.
                </p>
              )}
            </CardContent>
            <CardFooter className="flex flex-col items-stretch gap-3">
              {!review && (
                <Button
                  type="submit"
                  size="lg"
                  className="min-h-12 whitespace-normal"
                  disabled={!valid || editingDisabled || !!storageError}
                >
                  Review packing
                </Button>
              )}
              {review && !draft.submitted && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-12"
                  onClick={() => setReview(false)}
                  disabled={mutation.isPending}
                >
                  Edit counts
                </Button>
              )}
              <p className="text-xs text-muted-foreground">
                Stock changes only after you confirm.
              </p>
            </CardFooter>
          </Card>
        </form>
      )}

      {review && (
        <div ref={reviewRef} tabIndex={-1} className="outline-none">
          <Card>
            <CardHeader>
              <CardTitle>Check the physical counts</CardTitle>
              <CardDescription>
                Confirm these match what was packed. All formats will be saved
                together.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                Packed{" "}
                {dateValid
                  ? packingDate.toLocaleString("en-PK")
                  : "at an invalid time"}{" "}
                · local time
              </p>
              <ul className="flex flex-col gap-3">
                {draft.lines.map((line) => (
                  <li
                    key={line.recipeId}
                    className="flex flex-wrap justify-between gap-2 text-sm"
                  >
                    <strong>
                      {formats.find((format) => format.id === line.recipeId)
                        ?.name || "Saved format"}
                    </strong>
                    <span>
                      {line.fullCartons || 0} full cartons
                      {Number(line.partialPacks) > 0
                        ? ` + 1 partial carton (${line.partialPacks} packs)`
                        : ""}{" "}
                      + {line.loosePacks || 0} loose packs
                    </span>
                  </li>
                ))}
              </ul>
              <Separator />
              <p className="text-sm">
                {amount(bulk)} used in packs · {amount(loss)} lost ·{" "}
                {amount(remaining)} left to pack
              </p>
              {draft.submitted && (
                <Alert>
                  <AlertTitle>Check or retry this submission</AlertTitle>
                  <AlertDescription>
                    These counts are saved for retry. Retrying checks for an
                    existing receipt first, so it will not add the same stock
                    twice.
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
            <CardFooter className="flex flex-wrap gap-3">
              <Button
                type="button"
                size="lg"
                className="min-h-12 whitespace-normal"
                disabled={
                  mutation.isPending ||
                  checking ||
                  !batch.canRecord ||
                  (!draft.submitted && !valid)
                }
                onClick={() => void confirm()}
              >
                {mutation.isPending
                  ? "Saving packing…"
                  : draft.submitted
                    ? "Retry confirmation"
                    : "Confirm & add to finished goods"}
              </Button>
              {draft.submitted && (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-12"
                  disabled={mutation.isPending || checking}
                  onClick={() => void checkBeforeEditing()}
                >
                  {checking
                    ? "Checking saved result…"
                    : "Check result before editing"}
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>
      )}

      {receipts.length > 0 && (
        <section aria-label="Recorded packing" className="flex flex-col gap-4">
          <h3 className="text-lg font-semibold">Recorded packing</h3>
          {receipts.map((receipt) => (
            <Card key={receipt.id}>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle>
                    {receipt.totalPacks.toLocaleString()} packs recorded
                  </CardTitle>
                  <Badge variant="secondary">Saved</Badge>
                </div>
                <CardDescription>
                  {new Intl.DateTimeFormat("en-PK", {
                    dateStyle: "medium",
                    timeStyle: "short",
                    timeZone: "Asia/Karachi",
                  }).format(new Date(receipt.recordedAt))}{" "}
                  · Pakistan time
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-3">
                  {receipt.lines.map((line, index) => (
                    <li
                      key={index}
                      className="flex flex-wrap justify-between gap-2 text-sm"
                    >
                      <span>{line.name}</span>
                      <span className="tabular-nums">
                        {line.fullCartons} full cartons
                        {line.partialPacks
                          ? ` + 1 partial (${line.partialPacks} packs)`
                          : ""}{" "}
                        · {line.loosePacks} loose · {amount(line.actualBulk)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <p className="text-sm text-muted-foreground">
                  {amount(receipt.bulkConsumed)} used ·{" "}
                  {amount(receipt.lossBulk)} lost
                </p>
              </CardFooter>
            </Card>
          ))}
        </section>
      )}
    </section>
  );
}
