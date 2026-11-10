import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import type { OfflineDesk } from "@/hooks/sales/use-offline-desk";
import type { OfflineSalesUploadResult } from "@/lib/sales/offline/contracts";
import { formatPKR } from "@/lib/currency-format";
import { outageWindow, toPktIso, toPktLocalInput } from "@/lib/sales/offline/desk-time";

function errorText(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Something went wrong.";
}

export function SendPanel({ desk }: { desk: OfflineDesk }) {
  const unsent = desk.unsent;
  const total = useMemo(() => unsent.reduce((sum, entry) => sum + entry.invoiceAmount, 0), [unsent]);
  const earliest = useMemo(() => outageWindow(unsent, null).started, [unsent]);

  const [started, setStarted] = useState(() => toPktLocalInput(earliest));
  const [ended, setEnded] = useState(() => toPktLocalInput(desk.restoredAt ?? new Date()));
  const [reason, setReason] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<OfflineSalesUploadResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const canSend = desk.online && unsent.length > 0 && reason.trim().length >= 5 && !sending;

  const send = async () => {
    setSending(true);
    setProblem(null);
    try {
      const sent = await desk.send({
        outageStartedAt: toPktIso(started),
        outageEndedAt: toPktIso(ended),
        outageReason: reason.trim(),
      });
      setResult(sent);
      toast.success("Invoices sent to the office.");
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setSending(false);
    }
  };

  const backup = () => {
    const file = desk.buildBackup();
    if (!file) {
      toast.info("There is nothing to back up yet.");
      return;
    }
    const url = URL.createObjectURL(file.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success(`Backup of ${file.count} invoice(s) downloaded. Keep it somewhere safe.`);
  };

  const restore = async (file: File | undefined) => {
    if (!file) return;
    setRestoring(true);
    try {
      const outcome = await desk.restoreBackup(file);
      toast.success(`Restored ${outcome.restored} invoice(s)${outcome.skipped ? `, skipped ${outcome.skipped}` : ""}.`);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Back up this computer</CardTitle>
          <CardDescription>
            A backup file is a second copy of every invoice not yet sent. If this browser is ever cleared, the office
            can still upload the file.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button onClick={backup} disabled={unsent.length === 0}>
            Download backup ({unsent.length})
          </Button>
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
            <span className="text-muted-foreground">Restore from a backup file</span>
            <Input
              type="file"
              accept="application/json,.json"
              disabled={restoring || !desk.pack}
              className="w-64"
              onChange={(event) => {
                void restore(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Send to the office</CardTitle>
          <CardDescription>
            {unsent.length === 0
              ? "Every invoice on this computer has been sent."
              : `${unsent.length} invoice(s), ${formatPKR(total, false)} in total, are waiting to be sent.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          {!desk.online && (
            <Alert>
              <AlertTitle>No internet yet</AlertTitle>
              <AlertDescription>Sending works as soon as the internet is back. Your invoices stay safe here.</AlertDescription>
            </Alert>
          )}
          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="send-start">Internet stopped</FieldLabel>
              <Input id="send-start" type="datetime-local" value={started} onChange={(event) => setStarted(event.target.value)} />
              <FieldDescription>Pre-filled from your first invoice. Change it if the outage began earlier.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="send-end">Internet returned</FieldLabel>
              <Input id="send-end" type="datetime-local" value={ended} onChange={(event) => setEnded(event.target.value)} />
            </Field>
            <Field className="md:col-span-2">
              <FieldLabel htmlFor="send-reason">What caused the outage?</FieldLabel>
              <Textarea
                id="send-reason"
                rows={2}
                value={reason}
                placeholder="Example: factory internet line was down"
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
          </FieldGroup>

          {problem && (
            <Alert variant="destructive">
              <AlertTitle>Could not send</AlertTitle>
              <AlertDescription>
                <p>{problem}</p>
                <p>
                  If it says you are signed out,{" "}
                  <a className="underline" href="/login?redirect=/offline-desk">
                    sign in
                  </a>{" "}
                  and come back. Nothing was lost.
                </p>
              </AlertDescription>
            </Alert>
          )}
          {result && (
            <Alert>
              <AlertTitle>Sent. The office will review them.</AlertTitle>
              <AlertDescription>
                <p>
                  Ready {result.counts.ready} · Warnings {result.counts.warning} · Problems{" "}
                  {result.counts.invalid + result.counts.needsReview} · Already received {result.counts.duplicate}
                </p>
                <a className="underline" href={`/sales/offline?batch=${result.batchId}`}>
                  Open Sales → Offline invoices to review
                </a>
              </AlertDescription>
            </Alert>
          )}

          <div className="flex justify-end">
            <Button disabled={!canSend} onClick={() => void send()}>
              {sending && <Spinner data-icon="inline-start" />}
              {sending
                ? "Sending…"
                : unsent.length > 0
                  ? `Send and save ${unsent.length} invoice${unsent.length === 1 ? "" : "s"} to Database`
                  : "No invoices to send"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
