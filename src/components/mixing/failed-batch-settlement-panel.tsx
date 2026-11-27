import { useMemo, useState } from "react";
import Big from "big.js";
import { format } from "date-fns";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import {
  useFailedBatchSettlement,
  useSettleFailedBatchChemicals,
} from "@/hooks/manufacturing/mixing/use-failed-batch-settlement";
import { formatPKRPrecise } from "@/lib/currency-format";

type Draft = { include: boolean; recovered: string };

function parseRecovered(value: string, taken: number): { ok: true; value: number } | { ok: false; error: string } {
  if (value.trim() === "") return { ok: false, error: "Enter an amount" };
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return { ok: false, error: "Can't be negative" };
  if (number > taken) return { ok: false, error: `Max ${taken}` };
  if (Math.abs(number * 1000 - Math.round(number * 1000)) > 1e-6) return { ok: false, error: "Max 3 decimals" };
  return { ok: true, value: number };
}

/**
 * Shown on a failed mixing batch. Lets the user put back the chemicals the
 * batch took when it started, and writes off whatever could not be saved.
 */
export function FailedBatchSettlementPanel({ mixingRunId }: { mixingRunId: string }) {
  const { data, isLoading, error } = useFailedBatchSettlement(mixingRunId);
  const settle = useSettleFailedBatchChemicals();
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [reason, setReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const pending = useMemo(
    () => (data?.applies ? data.chemicals.filter((row) => !row.settlement) : []),
    [data],
  );

  const draftFor = (chemicalId: string, taken: number, startedBeforeLots: boolean): Draft =>
    drafts[chemicalId] ?? { include: true, recovered: startedBeforeLots ? "0" : String(taken) };

  const rows = pending.map((row) => {
    const draft = draftFor(row.chemicalId, row.taken, row.startedBeforeLots);
    const parsed = parseRecovered(draft.recovered, row.taken);
    const lost = parsed.ok ? Number(new Big(row.taken).minus(parsed.value).toFixed(3)) : null;
    const lossAmount = lost !== null && row.costPerUnit !== null
      ? Number(new Big(lost).times(row.costPerUnit).toFixed(2))
      : null;
    const lotError = row.startedBeforeLots && parsed.ok && parsed.value > 0
      ? "Started before price lots: only 0 can be returned"
      : null;
    return { row, draft, parsed, lost, lossAmount, error: parsed.ok ? lotError : parsed.error };
  });

  const selected = rows.filter((entry) => entry.draft.include);
  const formValid = selected.length > 0 && selected.every((entry) => !entry.error) && reason.trim().length > 0;
  const totalLoss = selected.reduce((sum, entry) => sum + (entry.lossAmount ?? 0), 0);

  if (isLoading) {
    return <Card><CardContent className="py-6 text-sm text-muted-foreground">Loading chemicals taken by this batch...</CardContent></Card>;
  }
  if (error) {
    return <Card><CardContent className="py-6 text-sm text-destructive">{error.message}</CardContent></Card>;
  }
  if (!data?.applies) return null;

  const update = (chemicalId: string, taken: number, startedBeforeLots: boolean, change: Partial<Draft>) =>
    setDrafts((current) => ({
      ...current,
      [chemicalId]: { ...draftFor(chemicalId, taken, startedBeforeLots), ...change },
    }));

  const fillAll = (mode: "all" | "none") =>
    setDrafts((current) => {
      const next = { ...current };
      for (const row of pending) {
        const draft = draftFor(row.chemicalId, row.taken, row.startedBeforeLots);
        next[row.chemicalId] = {
          ...draft,
          recovered: mode === "all" && !row.startedBeforeLots ? String(row.taken) : "0",
        };
      }
      return next;
    });

  const submit = () => {
    settle.mutate(
      {
        data: {
          mixingRunId,
          reason: reason.trim(),
          items: selected.map((entry) => ({
            chemicalId: entry.row.chemicalId,
            recoveredQuantity: entry.parsed.ok ? entry.parsed.value : 0,
          })),
        },
      },
      {
        onSuccess: () => {
          setConfirmOpen(false);
          setDrafts({});
          setReason("");
        },
      },
    );
  };

  return (
    <Card aria-label="Chemicals taken by this failed batch">
      <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <CardTitle>Chemicals taken by this batch</CardTitle>
          <CardDescription>
            This batch failed after its chemicals left stock on {data.factoryFloor}.
            Enter how much of each chemical you got back. It goes back into stock.
            Whatever you don't get back is written off as a loss.
          </CardDescription>
        </div>
        {data.pendingCount > 0 ? (
          <Badge variant="destructive">{data.pendingCount} to settle</Badge>
        ) : (
          <Badge variant="outline">All settled</Badge>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {data.failReason && (
          <p className="text-sm text-muted-foreground">
            Failed{data.failedAt ? ` on ${format(new Date(data.failedAt), "dd MMM yyyy HH:mm")}` : ""}. Reason: {data.failReason}
          </p>
        )}

        {data.hasOutput && (
          <Alert>
            <AlertTitle>Can't settle here</AlertTitle>
            <AlertDescription>This batch has logged output, so its chemicals count as used.</AlertDescription>
          </Alert>
        )}

        {pending.length > 0 && !data.canSettle && !data.hasOutput && (
          <Alert>
            <AlertTitle>Waiting for settlement</AlertTitle>
            <AlertDescription>
              The batch operator or someone with stock manage access needs to settle these chemicals.
            </AlertDescription>
          </Alert>
        )}

        {pending.length > 0 && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {data.canSettle && <TableHead className="w-10"><span className="sr-only">Include</span></TableHead>}
                  <TableHead>Chemical</TableHead>
                  <TableHead className="text-right">Taken</TableHead>
                  <TableHead className="w-44">Got back</TableHead>
                  <TableHead className="text-right">Written off</TableHead>
                  {data.seesCosts && <TableHead className="text-right">Loss</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ row, draft, lost, lossAmount, error: rowError }) => (
                  <TableRow key={row.chemicalId}>
                    {data.canSettle && (
                      <TableCell>
                        <Checkbox
                          checked={draft.include}
                          aria-label={`Include ${row.name}`}
                          onCheckedChange={(checked) =>
                            update(row.chemicalId, row.taken, row.startedBeforeLots, { include: checked === true })}
                        />
                      </TableCell>
                    )}
                    <TableCell className="font-medium">{row.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.taken} {row.unit}</TableCell>
                    <TableCell>
                      {data.canSettle ? (
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <Input
                              inputMode="decimal"
                              value={draft.recovered}
                              disabled={!draft.include || row.startedBeforeLots}
                              aria-label={`${row.name} got back`}
                              aria-invalid={draft.include && !!rowError}
                              onChange={(event) =>
                                update(row.chemicalId, row.taken, row.startedBeforeLots, { recovered: event.target.value })}
                              className="h-8"
                            />
                            <span className="text-xs text-muted-foreground">{row.unit}</span>
                          </div>
                          {draft.include && rowError && <span className="text-xs text-destructive">{rowError}</span>}
                          {row.startedBeforeLots && (
                            <span className="text-xs text-muted-foreground">Started before price lots, can only be written off</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">Not settled</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {data.canSettle && draft.include && lost !== null ? `${lost} ${row.unit}` : "-"}
                    </TableCell>
                    {data.seesCosts && (
                      <TableCell className="text-right tabular-nums">
                        {data.canSettle && draft.include && lossAmount !== null ? formatPKRPrecise(lossAmount) : "-"}
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {pending.length > 0 && data.canSettle && (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fillAll("all")}>
                Got everything back
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => fillAll("none")}>
                Nothing could be saved
              </Button>
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor={`settle-reason-${mixingRunId}`} className="text-sm font-medium">Reason</label>
              <Textarea
                id={`settle-reason-${mixingRunId}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="What happened to the chemicals, e.g. Mixer broke before adding water, all chemicals kept in drums"
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {selected.length} of {pending.length} chemical{pending.length === 1 ? "" : "s"} selected
                {data.seesCosts && selected.length > 0 ? `, loss ${formatPKRPrecise(totalLoss)}` : ""}
              </p>
              <Button disabled={!formValid || settle.isPending} onClick={() => setConfirmOpen(true)}>
                {settle.isPending ? "Settling..." : `Settle ${selected.length} chemical${selected.length === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        )}

        {data.chemicals.some((row) => row.settlement) && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Already settled</h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Chemical</TableHead>
                    <TableHead className="text-right">Taken</TableHead>
                    <TableHead className="text-right">Got back</TableHead>
                    <TableHead className="text-right">Written off</TableHead>
                    {data.seesCosts && <TableHead className="text-right">Loss</TableHead>}
                    <TableHead>By</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.chemicals.filter((row) => row.settlement).map((row) => (
                    <TableRow key={row.chemicalId}>
                      <TableCell className="font-medium">
                        {row.name}
                        {row.settlement!.notes && (
                          <p className="text-xs font-normal text-muted-foreground">{row.settlement!.notes}</p>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{row.taken} {row.unit}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.settlement!.recovered} {row.unit}</TableCell>
                      <TableCell className="text-right tabular-nums">{row.settlement!.lost} {row.unit}</TableCell>
                      {data.seesCosts && (
                        <TableCell className="text-right tabular-nums">
                          {row.settlement!.lossAmount === null ? "-" : formatPKRPrecise(row.settlement!.lossAmount)}
                        </TableCell>
                      )}
                      <TableCell className="text-sm">
                        {row.settlement!.settledBy}
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(row.settlement!.settledAt), "dd MMM yyyy HH:mm")}
                        </p>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Settle chemicals for batch {data.batchId}?</AlertDialogTitle>
            <AlertDialogDescription>
              This can't be undone. Each chemical can only be settled once.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="flex flex-col gap-1 text-sm">
            {selected.map((entry) => (
              <li key={entry.row.chemicalId} className="flex justify-between gap-4">
                <span>{entry.row.name}</span>
                <span className="tabular-nums text-muted-foreground">
                  back {entry.parsed.ok ? entry.parsed.value : 0} · lost {entry.lost ?? 0} {entry.row.unit}
                </span>
              </li>
            ))}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={settle.isPending}>Go back</AlertDialogCancel>
            <AlertDialogAction
              disabled={settle.isPending}
              onClick={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              {settle.isPending ? "Settling..." : "Settle"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
