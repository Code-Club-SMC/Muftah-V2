import { useMemo, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import { ImportHistory } from "./import-history";
import { StockReconciliationPanel } from "./stock-reconciliation-panel";
import { UploadPanel } from "./upload-panel";
import { WorkbookPanel } from "./workbook-panel";

const steps = [
  {
    number: "01",
    title: "Keep it ready",
    text: "Download the official workbook and keep it on the factory computer before any outage.",
    icon: FileDownloadIcon,
  },
  {
    number: "02",
    title: "Work during outage",
    text: "Enter invoices in that workbook only while the web app is unavailable.",
    icon: InternetIcon,
  },
  {
    number: "03",
    title: "Upload and check",
    text: "When internet returns, upload it, review warnings, then post records to the database.",
    icon: Database01Icon,
  },
] as const;

type TabName = "workbook" | "review" | "history" | "stock";

export function OfflineSalesPage() {
  const { data: viewerAccess, isLoading } = useViewerAccess();
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [requestedTab, setRequestedTab] = useState<TabName | null>(null);
  const permissions = viewerAccess?.permissions ?? [];
  const canManageWorkbooks = hasPermission(
    permissions,
    "sales.offline.workbooks.manage",
  );
  const canUpload = hasPermission(permissions, "sales.offline.upload");
  const canReview = hasPermission(permissions, "sales.offline.review");
  const canPost = hasPermission(permissions, "sales.offline.post");
  const canManageStock = hasPermission(
    permissions,
    "inventory.stock-reconciliation.manage",
  );
  const canUseReview = canUpload || canReview || canPost;

  const availableTabs = useMemo(() => {
    const values: TabName[] = [];
    if (canManageWorkbooks) values.push("workbook");
    if (canUseReview) values.push("review");
    values.push("history");
    if (canManageStock) values.push("stock");
    return values;
  }, [canManageStock, canManageWorkbooks, canUseReview]);
  const activeTab =
    requestedTab && availableTabs.includes(requestedTab)
      ? requestedTab
      : (availableTabs[0] ?? "history");

  if (isLoading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Offline invoices
          </h1>
          <Badge variant="secondary">Factory F01 · Excel fallback</Badge>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Keep factory sales moving during an internet outage. Excel captures
          the work temporarily; the database remains the final record after
          review.
        </p>
      </header>

      <Alert>
        <HugeiconsIcon icon={FileUploadIcon} strokeWidth={2} />
        <AlertTitle>Use only the official workbook</AlertTitle>
        <AlertDescription>
          Do not make a blank Excel file during an outage. Prices, invoice
          numbers, distributors, products, orders, and accounts come from the
          signed workbook.
        </AlertDescription>
      </Alert>

      <div className="grid gap-3 lg:grid-cols-3">
        {steps.map((step) => (
          <section key={step.number} className="border bg-card p-4">
            <div className="flex items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center border bg-muted">
                <HugeiconsIcon icon={step.icon} strokeWidth={2} />
              </div>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="font-mono text-xs text-muted-foreground">
                  STEP {step.number}
                </p>
                <h2 className="font-medium">{step.title}</h2>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {step.text}
                </p>
              </div>
            </div>
          </section>
        ))}
      </div>

      <Separator />

      <Tabs
        value={activeTab}
        onValueChange={(value) => setRequestedTab(value as TabName)}
      >
        <TabsList className="h-auto flex-wrap justify-start">
          {canManageWorkbooks && (
            <TabsTrigger value="workbook">Workbook</TabsTrigger>
          )}
          {canUseReview && (
            <TabsTrigger value="review">Upload &amp; Review</TabsTrigger>
          )}
          <TabsTrigger value="history">Import History</TabsTrigger>
          {canManageStock && (
            <TabsTrigger value="stock">Stock Issues</TabsTrigger>
          )}
        </TabsList>

        {canManageWorkbooks && (
          <TabsContent value="workbook" className="mt-5">
            <WorkbookPanel />
          </TabsContent>
        )}
        {canUseReview && (
          <TabsContent value="review" className="mt-5">
            <UploadPanel
              selectedBatchId={selectedBatchId}
              onSelectBatch={setSelectedBatchId}
              canUpload={canUpload}
              canReview={canReview}
              canPost={canPost}
            />
          </TabsContent>
        )}
        <TabsContent value="history" className="mt-5">
          <ImportHistory
            onReview={(batchId) => {
              setSelectedBatchId(batchId);
              if (canUseReview) setRequestedTab("review");
            }}
            canReview={canUseReview}
          />
        </TabsContent>
        {canManageStock && (
          <TabsContent value="stock" className="mt-5">
            <StockReconciliationPanel />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
