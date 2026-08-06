import { HugeiconsIcon } from "@hugeicons/react";
import {
  Database01Icon,
  FileDownloadIcon,
  FileUploadIcon,
  InternetIcon,
} from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { UploadPanel } from "./upload-panel";
import { WorkbookPanel } from "./workbook-panel";

const steps = [
  {
    title: "Normal setup",
    text: "Keep signed Excel workbook ready at attendance terminal every day.",
    icon: FileDownloadIcon,
  },
  {
    title: "During outage",
    text: "Operator records employee code, time, IN/OUT in that workbook.",
    icon: InternetIcon,
  },
  {
    title: "After internet returns",
    text: "Upload workbook. App validates rows, then saves attendance to database.",
    icon: Database01Icon,
  },
] as const;

export function OfflineAttendancePage() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-8 pt-6">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">
                Offline attendance
              </h1>
              <Badge variant="secondary">Excel fallback</Badge>
            </div>
            <p className="max-w-3xl text-sm text-muted-foreground">
              This flow protects factory attendance when internet is down. Excel
              is temporary capture tool only; final system of record stays database.
            </p>
          </div>
        </div>

        <Alert>
          <HugeiconsIcon icon={FileUploadIcon} strokeWidth={2} />
          <AlertTitle>Plain rule for operators</AlertTitle>
          <AlertDescription>
            If scanner cannot reach server, write attendance in assigned workbook.
            Do not create random new file. Upload same workbook when internet returns.
          </AlertDescription>
        </Alert>

        <div className="grid gap-4 md:grid-cols-3">
          {steps.map((step) => (
            <div key={step.title} className="rounded-xl border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="rounded-full bg-muted p-2">
                  <HugeiconsIcon icon={step.icon} strokeWidth={2} className="size-4" />
                </div>
                <div className="flex flex-col gap-1">
                  <h2 className="font-medium">{step.title}</h2>
                  <p className="text-sm text-muted-foreground">{step.text}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      <div className="grid gap-6">
        <WorkbookPanel />
        <UploadPanel />
      </div>
    </div>
  );
}
