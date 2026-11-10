import { useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Database01Icon,
  FileDownloadIcon,
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
    title: "Prepare once",
    text: "While the internet works, open the offline desk and press Prepare this computer. It saves prices and invoice numbers on that computer.",
    icon: FileDownloadIcon,
  },
  {
    number: "02",
    title: "Work during outage",
    text: "Make and print invoices in the offline desk. Everything is saved on the computer, so nothing is lost if the page closes.",
    icon: InternetIcon,
  },
  {
    number: "03",
    title: "Send and review",
    text: "When internet returns, send the invoices to the office, then review warnings and post them here.",
    icon: Database01Icon,
  },
] as const;

type TabName = "workbook" | "review" | "history" | "stock";

export function OfflineSalesPage({
  initialBatchId,
}: {
  initialBatchId?: string;
}) {
  const { data: viewerAccess, isLoading } = useViewerAccess();
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(
    initialBatchId ?? null,
  );
  // Arriving from the offline desk with a batch opens the Review tab on it.
  const [requestedTab, setRequestedTab] = useState<TabName | null>(
    initialBatchId ? "review" : null,
  );
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
          <Badge variant="secondary">Factory F01</Badge>
        </div>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          Keep factory sales moving during an internet outage. Invoices are made
          and printed offline, then reviewed here. The database remains the final record after review.
        </p>
      </header>

      {(canUpload || canManageWorkbooks) && (
        <Alert>
          <HugeiconsIcon icon={InternetIcon} strokeWidth={2} />
          <AlertTitle>Offline invoice desk</AlertTitle>
          <AlertDescription>
            Make and print invoices straight from the browser, even with no
            internet. Prices and invoice numbers are saved on the computer in advance.{" "}
            <a className="font-medium underline" href="/offline-desk">
              Open the offline desk
            </a>
            .
          </AlertDescription>
        </Alert>
      )}

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
            <TabsTrigger value="workbook">Invoice numbers</TabsTrigger>
          )}
          {canUseReview && (
            <TabsTrigger value="review">Review</TabsTrigger>
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
