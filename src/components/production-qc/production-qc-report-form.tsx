import { useId, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import {
  createMixingLabReportFn,
  updateMixingLabReportFn,
  type MixingLabReport,
} from "@/server-functions/manufacturing/mixing/lab-reports-fn";

type AnalysisItem = MixingLabReport["analysisItems"][number];
const productionChecks: AnalysisItem[] = [
  {
    item: "Appearance",
    requirement: "Matches approved reference sample",
    result: "",
    passed: false,
  },
  {
    item: "Colour",
    requirement: "Matches product specification",
    result: "",
    passed: false,
  },
  {
    item: "Odour",
    requirement: "Matches product specification",
    result: "",
    passed: false,
  },
  {
    item: "pH",
    requirement: "Within product specification",
    result: "",
    passed: false,
  },
  {
    item: "Viscosity",
    requirement: "Within product specification at test temperature",
    result: "",
    passed: false,
  },
  {
    item: "Bulk homogeneity",
    requirement: "Uniform mix with no visible separation",
    result: "",
    passed: false,
  },
];

export function qcDate(value: Date | string = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Karachi" }).format(
    new Date(value),
  );
}

export function ProductionQCReportForm({
  mixingRunId,
  batchId,
  productName,
  report,
  onClose,
}: {
  mixingRunId: string;
  batchId?: string;
  productName?: string;
  report?: MixingLabReport;
  onClose: () => void;
}) {
  const fieldId = useId();
  const queryClient = useQueryClient();
  const [fields, setFields] = useState({
    stockNumber: report?.stockNumber ?? "",
    lotNumber: report?.lotNumber ?? batchId ?? "",
    certifiedBy: report?.certifiedBy ?? "",
    certifierTitle: report?.certifierTitle ?? "",
    reportDate: qcDate(report?.reportDate),
    standardReference: report?.standardReference ?? "",
    notes: report?.notes ?? "",
  });
  const [checks, setChecks] = useState<AnalysisItem[]>(() =>
    (report?.analysisItems ?? productionChecks).map((check) => ({ ...check })),
  );
  async function saved() {
    await queryClient.invalidateQueries({
      queryKey: ["mixing-lab-reports", mixingRunId],
    });
    toast.success(report ? "Quality report updated" : "Quality report created");
    onClose();
  }
  const createReport = useMutation({
    mutationFn: createMixingLabReportFn,
    onSuccess: saved,
  });
  const updateReport = useMutation({
    mutationFn: updateMixingLabReportFn,
    onSuccess: saved,
  });
  const pending = createReport.isPending || updateReport.isPending;
  const error = createReport.error ?? updateReport.error;
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = { mixingRunId, ...fields, analysisItems: checks };
    if (report) updateReport.mutate({ data: { ...data, reportId: report.id } });
    else createReport.mutate({ data });
  }
  function updateCheck(index: number, value: Partial<AnalysisItem>) {
    setChecks((current) =>
      current.map((check, position) =>
        position === index ? { ...check, ...value } : check,
      ),
    );
  }
  const valid =
    fields.certifiedBy.trim() &&
    fields.reportDate &&
    checks.length > 0 &&
    checks.every(
      (check) =>
        check.item.trim() && check.requirement.trim() && check.result.trim(),
    );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
        showCloseButton={!pending}
      >
        <DialogHeader>
          <DialogTitle>
            {report ? "Edit quality report" : "Create quality report"}
          </DialogTitle>
          <DialogDescription>
            {report?.productName ?? productName ?? "Selected mixing batch"}
            {batchId ? ` · Batch ${batchId}` : ""}. Adjust the checks and
            requirements for this product before certifying.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <FieldSet disabled={pending}>
              <FieldLegend>Certificate details</FieldLegend>
              <FieldGroup className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["stockNumber", "Stock number", false],
                    ["lotNumber", "Lot number", false],
                    ["certifiedBy", "Certified by", true],
                    ["certifierTitle", "Certifier title", false],
                    ["reportDate", "Report date", true],
                    ["standardReference", "Standard reference", false],
                  ] as const
                ).map(([key, label, required]) => (
                  <Field key={key}>
                    <FieldLabel htmlFor={`${fieldId}-${key}`}>
                      {label}
                      {required ? " *" : ""}
                    </FieldLabel>
                    <Input
                      id={`${fieldId}-${key}`}
                      required={required}
                      type={key === "reportDate" ? "date" : "text"}
                      maxLength={key === "certifiedBy" ? 200 : 500}
                      value={fields[key]}
                      onChange={(event) =>
                        setFields((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                    />
                  </Field>
                ))}
              </FieldGroup>
            </FieldSet>
            <FieldSet disabled={pending}>
              <FieldLegend>Analysis checks</FieldLegend>
              <p className="text-sm text-muted-foreground">
                Enter the measured result and mark each passing check. Remove
                checks that do not apply.
              </p>
              {checks.map((check, index) => (
                <FieldSet key={index} className="rounded-xl border p-4">
                  <FieldLegend variant="label">Check {index + 1}</FieldLegend>
                  <FieldGroup className="grid gap-4 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor={`${fieldId}-check-${index}`}>
                        Check name *
                      </FieldLabel>
                      <Input
                        id={`${fieldId}-check-${index}`}
                        required
                        maxLength={200}
                        value={check.item}
                        onChange={(event) =>
                          updateCheck(index, { item: event.target.value })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`${fieldId}-requirement-${index}`}>
                        Requirement *
                      </FieldLabel>
                      <Input
                        id={`${fieldId}-requirement-${index}`}
                        required
                        maxLength={1000}
                        value={check.requirement}
                        onChange={(event) =>
                          updateCheck(index, {
                            requirement: event.target.value,
                          })
                        }
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`${fieldId}-result-${index}`}>
                        Result *
                      </FieldLabel>
                      <Input
                        id={`${fieldId}-result-${index}`}
                        required
                        maxLength={1000}
                        value={check.result}
                        onChange={(event) =>
                          updateCheck(index, { result: event.target.value })
                        }
                      />
                    </Field>
                    <Field orientation="horizontal">
                      <Checkbox
                        id={`${fieldId}-passed-${index}`}
                        checked={check.passed}
                        onCheckedChange={(value) =>
                          updateCheck(index, { passed: value === true })
                        }
                      />
                      <FieldLabel htmlFor={`${fieldId}-passed-${index}`}>
                        Passed check {index + 1}
                      </FieldLabel>
                    </Field>
                  </FieldGroup>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={checks.length === 1}
                    onClick={() =>
                      setChecks((current) =>
                        current.filter((_, position) => position !== index),
                      )
                    }
                  >
                    Remove check {index + 1}
                  </Button>
                </FieldSet>
              ))}
              <Button
                type="button"
                variant="outline"
                disabled={checks.length >= 100}
                onClick={() =>
                  setChecks((current) => [
                    ...current,
                    { item: "", requirement: "", result: "", passed: false },
                  ])
                }
              >
                Add analysis check
              </Button>
            </FieldSet>
            <Field data-disabled={pending}>
              <FieldLabel htmlFor={`${fieldId}-notes`}>Notes</FieldLabel>
              <Textarea
                id={`${fieldId}-notes`}
                disabled={pending}
                maxLength={10000}
                value={fields.notes}
                onChange={(event) =>
                  setFields((current) => ({
                    ...current,
                    notes: event.target.value,
                  }))
                }
              />
            </Field>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error.message}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={pending || !valid}>
                {pending ? "Saving report..." : "Save quality report"}
              </Button>
            </div>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  );
}
