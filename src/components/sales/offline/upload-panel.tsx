import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { FileUploadIcon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  useOfflineSalesHistory,
  useUploadOfflineSalesBackup,
} from "@/hooks/sales/use-offline-sales";
import { batchSource, batchStatusLabel, dateTime } from "./format";
import { ReviewPanel } from "./review-panel";

const PKT_OFFSET = "+05:00";

function toPktIso(value: string) {
  if (!value) return value;
  return `${value.length === 16 ? `${value}:00` : value}${PKT_OFFSET}`;
}

export function UploadPanel({
  selectedBatchId,
  onSelectBatch,
  canUpload,
  canReview,
  canPost,
}: {
  selectedBatchId: string | null;
  onSelectBatch: (batchId: string | null) => void;
  canUpload: boolean;
  canReview: boolean;
  canPost: boolean;
}) {
  const [formOpen, setFormOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [outageStartedAt, setOutageStartedAt] = useState("");
  const [outageEndedAt, setOutageEndedAt] = useState("");
  const [outageReason, setOutageReason] = useState("");
  const upload = useUploadOfflineSalesBackup();
  const history = useOfflineSalesHistory();
  const reviewableBatches = useMemo(
    () =>
      (history.data ?? []).filter(
        (batch) => batch.workbookId && batch.status !== "rejected",
      ),
    [history.data],
  );
  // History is newest first, so open the latest batch until one is picked.
  const activeBatchId = selectedBatchId ?? reviewableBatches[0]?.id ?? null;
  const reasonTooShort =
    outageReason.length > 0 && outageReason.trim().length < 5;
  const canSubmit =
    file != null &&
    outageStartedAt !== "" &&
    outageEndedAt !== "" &&
    outageReason.trim().length >= 5 &&
    !upload.isPending;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || !file) return;
    upload.mutate(
      {
        file,
        outageStartedAt: toPktIso(outageStartedAt),
        outageEndedAt: toPktIso(outageEndedAt),
        outageReason: outageReason.trim(),
      },
      {
        onSuccess: (result) => {
          setFile(null);
          setFileInputKey((value) => value + 1);
          setFormOpen(false);
          onSelectBatch(result.batchId);
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <Field className="min-w-64 flex-1">
          <FieldLabel>Batch</FieldLabel>
          <Select
            value={activeBatchId ?? ""}
            onValueChange={(value) => onSelectBatch(value)}
            disabled={history.isLoading || reviewableBatches.length === 0}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="No batches yet" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {reviewableBatches.map((batch) => (
                  <SelectItem key={batch.id} value={batch.id}>
                    {dateTime(batch.uploadedAt)} ·{" "}
                    {batchSource(batch.originalFilename)} ·{" "}
                    {batchStatusLabel(batch.status)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </Field>
        {canUpload && (
          <Button variant="outline" onClick={() => setFormOpen((open) => !open)}>
            <HugeiconsIcon
              icon={FileUploadIcon}
              strokeWidth={2}
              data-icon="inline-start"
            />
            {formOpen ? "Hide backup upload" : "Upload backup file"}
          </Button>
        )}
      </div>

      {canUpload && (
        <Card hidden={!formOpen}>
          <CardHeader>
            <CardTitle>Upload backup file</CardTitle>
            <CardDescription>
              Only if the offline computer lost its data. Use the .json file
              saved by Send &amp; backup. Times are Pakistan factory time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-5">
              <FieldGroup className="grid gap-5 md:grid-cols-2">
                <Field className="md:col-span-2">
                  <FieldLabel htmlFor="offline-sales-file">
                    Backup file
                  </FieldLabel>
                  <Input
                    key={fileInputKey}
                    id="offline-sales-file"
                    type="file"
                    accept=".json,application/json"
                    aria-invalid={Boolean(
                      file && !file.name.toLowerCase().endsWith(".json"),
                    )}
                    onChange={(event) =>
                      setFile(event.target.files?.[0] ?? null)
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="outage-start">
                    Internet stopped
                  </FieldLabel>
                  <Input
                    id="outage-start"
                    type="datetime-local"
                    value={outageStartedAt}
                    onChange={(event) => setOutageStartedAt(event.target.value)}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="outage-end">
                    Internet returned
                  </FieldLabel>
                  <Input
                    id="outage-end"
                    type="datetime-local"
                    value={outageEndedAt}
                    onChange={(event) => setOutageEndedAt(event.target.value)}
                  />
                </Field>
                <Field className="md:col-span-2" data-invalid={reasonTooShort}>
                  <FieldLabel htmlFor="outage-reason">
                    What caused the outage?
                  </FieldLabel>
                  <Textarea
                    id="outage-reason"
                    value={outageReason}
                    aria-invalid={reasonTooShort}
                    placeholder="Example: factory internet line was unavailable"
                    onChange={(event) => setOutageReason(event.target.value)}
                  />
                </Field>
              </FieldGroup>
              <div className="flex justify-end">
                <Button type="submit" disabled={!canSubmit}>
                  {upload.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <HugeiconsIcon
                      icon={FileUploadIcon}
                      strokeWidth={2}
                      data-icon="inline-start"
                    />
                  )}
                  {upload.isPending ? "Checking…" : "Upload and check"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <ReviewPanel
        batchId={activeBatchId}
        canReview={canReview}
        canPost={canPost}
      />
    </div>
  );
}
