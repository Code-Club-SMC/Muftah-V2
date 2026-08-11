import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Calendar02Icon, FileUploadIcon } from "@hugeicons/core-free-icons";
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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  useOfflineSalesHistory,
  useUploadOfflineSalesWorkbook,
} from "@/hooks/sales/use-offline-sales";
import { ReviewPanel } from "./review-panel";

const PKT_OFFSET = "+05:00";

function toPktIso(value: string) {
  if (!value) return value;
  return `${value.length === 16 ? `${value}:00` : value}${PKT_OFFSET}`;
}

function dateTime(value: Date | string) {
  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  }).format(new Date(value));
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
  const [file, setFile] = useState<File | null>(null);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [outageStartedAt, setOutageStartedAt] = useState("");
  const [outageEndedAt, setOutageEndedAt] = useState("");
  const [outageReason, setOutageReason] = useState("");
  const upload = useUploadOfflineSalesWorkbook();
  const history = useOfflineSalesHistory();
  const reviewableBatches = useMemo(
    () =>
      (history.data ?? []).filter(
        (batch) => batch.workbookId && batch.status !== "rejected",
      ),
    [history.data],
  );
  const canSubmit =
    file != null &&
    outageStartedAt !== "" &&
    outageEndedAt !== "" &&
    outageReason.trim().length >= 5 &&
    !upload.isPending;

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSubmit || !file) return;
    const form = new FormData();
    form.set("file", file);
    form.set("outageStartedAt", toPktIso(outageStartedAt));
    form.set("outageEndedAt", toPktIso(outageEndedAt));
    form.set("outageReason", outageReason.trim());
    upload.mutate(form, {
      onSuccess: (result) => {
        setFile(null);
        setFileInputKey((value) => value + 1);
        if (result.status !== "rejected") onSelectBatch(result.batchId);
      },
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {canUpload && (
        <Card>
          <CardHeader>
            <CardTitle>Upload outage workbook</CardTitle>
            <CardDescription>
              Server reads signed rows, saves normalized records, then discards
              Excel bytes. Original document is never stored.
            </CardDescription>
            <CardAction>
              <Badge variant="outline">.xlsx · 1–10 MB</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <Alert>
              <HugeiconsIcon icon={Calendar02Icon} strokeWidth={2} />
              <AlertTitle>Use Pakistan factory time</AlertTitle>
              <AlertDescription>
                Enter when internet stopped and returned. Invoice/payment times
                inside Excel must fall within this window.
              </AlertDescription>
            </Alert>
            <form onSubmit={submit} className="flex flex-col gap-5">
              <FieldGroup className="grid gap-5 md:grid-cols-2">
                <Field className="md:col-span-2">
                  <FieldLabel htmlFor="offline-sales-file">
                    Official workbook
                  </FieldLabel>
                  <Input
                    key={fileInputKey}
                    id="offline-sales-file"
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    aria-invalid={Boolean(
                      file && !file.name.toLowerCase().endsWith(".xlsx"),
                    )}
                    onChange={(event) =>
                      setFile(event.target.files?.[0] ?? null)
                    }
                  />
                  <FieldDescription>
                    Upload `.xlsx` only. Correct the same workbook and upload
                    again if rows are invalid.
                  </FieldDescription>
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
                <Field
                  className="md:col-span-2"
                  data-invalid={
                    outageReason.length > 0 && outageReason.trim().length < 5
                  }
                >
                  <FieldLabel htmlFor="outage-reason">
                    What caused the outage?
                  </FieldLabel>
                  <Textarea
                    id="outage-reason"
                    value={outageReason}
                    aria-invalid={
                      outageReason.length > 0 && outageReason.trim().length < 5
                    }
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
                  {upload.isPending ? "Checking workbook…" : "Upload and check"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Review a batch</CardTitle>
          <CardDescription>
            Choose an upload. Ready rows can post; warnings require
            acknowledgement; invalid rows must be corrected in Excel and
            uploaded again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Field>
            <FieldLabel>Uploaded workbook</FieldLabel>
            <Select
              value={selectedBatchId ?? ""}
              onValueChange={(value) => onSelectBatch(value)}
              disabled={history.isLoading}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select an uploaded workbook" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {reviewableBatches.map((batch) => (
                    <SelectItem key={batch.id} value={batch.id}>
                      {batch.originalFilename} · {dateTime(batch.uploadedAt)} ·{" "}
                      {batch.status.replaceAll("_", " ")}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
        </CardContent>
      </Card>

      <ReviewPanel
        batchId={selectedBatchId}
        canReview={canReview}
        canPost={canPost}
      />
    </div>
  );
}
