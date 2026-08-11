import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertSquareIcon,
  Database01Icon,
  Refresh03Icon,
} from "@hugeicons/core-free-icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
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
import { Textarea } from "@/components/ui/textarea";
import {
  useAcknowledgeOfflineSalesWarning,
  useExcludeOfflineSalesInvoice,
  useOfflineSalesBatch,
  useOfflineSalesReplacementWallets,
  usePostOfflineSalesBatch,
  useRefreshOfflineSalesPreview,
  useReplaceOfflineSalesWallet,
  useResolveOfflineSalesOrderConflict,
} from "@/hooks/sales/use-offline-sales";
import type { OfflineSalesBatchDetail } from "@/lib/sales/offline/contracts";

type Invoice = OfflineSalesBatchDetail["invoices"][number];
type Wallet = { id: string; name: string; type: string };
type OrderConflictResolution =
  | "same_dispatch_duplicate"
  | "replace_incorrect_online"
  | "second_physical_dispatch";

const PKR = (value: string | number) =>
  `PKR ${Number(value).toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

function dateTime(value: Date | string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-PK", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Karachi",
  }).format(new Date(value));
}

function statusLabel(status: Invoice["status"]) {
  const labels: Record<Invoice["status"], string> = {
    ready: "Ready",
    warning: "Warning",
    duplicate: "Duplicate",
    invalid: "Invalid",
    needs_review: "Needs Review",
    posted: "Posted",
    excluded: "Excluded",
  };
  return labels[status];
}

function statusVariant(status: Invoice["status"]) {
  if (status === "ready" || status === "posted") return "default" as const;
  if (status === "invalid" || status === "needs_review")
    return "destructive" as const;
  if (status === "warning") return "secondary" as const;
  return "outline" as const;
}

function paymentLabel(method: Invoice["payments"][number]["method"]) {
  if (method === "bank_transfer") return "Bank transfer";
  if (method === "cheque") return "Cheque";
  return "Paid Amount";
}

function Counts({ counts }: { counts: OfflineSalesBatchDetail["counts"] }) {
  const values = [
    ["Total", counts.total],
    ["Ready", counts.ready],
    ["Warning", counts.warning],
    ["Needs review", counts.needsReview],
    ["Invalid", counts.invalid],
    ["Duplicate", counts.duplicate],
    ["Posted", counts.posted],
    ["Excluded", counts.excluded],
  ] as const;
  return (
    <div className="grid gap-px border bg-border sm:grid-cols-4 lg:grid-cols-8">
      {values.map(([label, value]) => (
        <div key={label} className="bg-card p-3">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-semibold tabular-nums">{value}</p>
        </div>
      ))}
    </div>
  );
}

function OrderConflict({
  batchId,
  invoice,
}: {
  batchId: string;
  invoice: Invoice;
}) {
  const [resolution, setResolution] = useState<OrderConflictResolution>(
    "same_dispatch_duplicate",
  );
  const [existingInvoiceId, setExistingInvoiceId] = useState("");
  const [reason, setReason] = useState("");
  const resolve = useResolveOfflineSalesOrderConflict();
  const hasConflict = invoice.issueCodes.includes("order_already_invoiced");
  if (!hasConflict || invoice.orderInvoiceCandidates.length === 0) return null;

  return (
    <Alert variant="destructive">
      <HugeiconsIcon icon={AlertSquareIcon} strokeWidth={2} />
      <AlertTitle>Booked order already has an invoice</AlertTitle>
      <AlertDescription className="flex flex-col gap-4">
        <p>
          Choose what physically happened. This decision is saved in the audit
          trail.
        </p>
        <FieldGroup className="grid gap-4 lg:grid-cols-3">
          <Field>
            <FieldLabel>Decision</FieldLabel>
            <Select
              value={resolution}
              onValueChange={(value) =>
                setResolution(value as OrderConflictResolution)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="same_dispatch_duplicate">
                    Same delivery — exclude Excel row
                  </SelectItem>
                  <SelectItem value="replace_incorrect_online">
                    Replace a voided wrong invoice
                  </SelectItem>
                  <SelectItem value="second_physical_dispatch">
                    A second real delivery happened
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Existing invoice</FieldLabel>
            <Select
              value={existingInvoiceId}
              onValueChange={setExistingInvoiceId}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose invoice" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {invoice.orderInvoiceCandidates.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.invoiceNumber} · {candidate.status}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel>Reason</FieldLabel>
            <Textarea
              value={reason}
              placeholder="Explain what was checked"
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
        </FieldGroup>
        <div>
          <Button
            size="sm"
            disabled={
              !existingInvoiceId ||
              reason.trim().length < 5 ||
              resolve.isPending
            }
            onClick={() =>
              resolve.mutate({
                batchId,
                stagedInvoiceId: invoice.stagedInvoiceId,
                resolution,
                existingInvoiceId,
                reason: reason.trim(),
              })
            }
          >
            {resolve.isPending && <Spinner data-icon="inline-start" />}
            Save order decision
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

function PaymentTable({
  batchId,
  invoice,
  wallets,
  canReview,
}: {
  batchId: string;
  invoice: Invoice;
  wallets: Wallet[];
  canReview: boolean;
}) {
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const replace = useReplaceOfflineSalesWallet();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Excel row</TableHead>
          <TableHead>Method</TableHead>
          <TableHead>Destination account</TableHead>
          <TableHead>Reference</TableHead>
          <TableHead className="text-right">Amount</TableHead>
          {canReview && (
            <TableHead className="text-right">Correction</TableHead>
          )}
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoice.payments.length === 0 ? (
          <TableRow>
            <TableCell
              colSpan={canReview ? 6 : 5}
              className="text-center text-muted-foreground"
            >
              Pay later — no payment rows
            </TableCell>
          </TableRow>
        ) : (
          invoice.payments.map((payment) => {
            const requiredType = payment.method === "cash" ? "cash" : "bank";
            const accountUnavailable = payment.walletType !== requiredType;
            const choices = wallets.filter(
              (wallet) => wallet.type === requiredType,
            );
            return (
              <TableRow key={payment.id}>
                <TableCell>Payments!{payment.worksheetRowNumber}</TableCell>
                <TableCell>
                  <div className="flex flex-col gap-1">
                    <span>{paymentLabel(payment.method)}</span>
                    {payment.method !== "cash" && (
                      <Badge variant="outline">Pending Verification</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {payment.walletName ?? payment.walletCode}
                </TableCell>
                <TableCell>
                  {payment.reference ?? payment.chequeNumber ?? "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {PKR(payment.amount)}
                </TableCell>
                {canReview && (
                  <TableCell>
                    {accountUnavailable ? (
                      <div className="flex min-w-72 justify-end gap-2">
                        <Select
                          value={replacements[payment.id] ?? ""}
                          onValueChange={(value) =>
                            setReplacements((current) => ({
                              ...current,
                              [payment.id]: value,
                            }))
                          }
                        >
                          <SelectTrigger className="w-48">
                            <SelectValue
                              placeholder={`Choose ${requiredType} account`}
                            />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectGroup>
                              {choices.map((wallet) => (
                                <SelectItem key={wallet.id} value={wallet.id}>
                                  {wallet.name}
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            !replacements[payment.id] || replace.isPending
                          }
                          onClick={() => {
                            const replacementWalletId =
                              replacements[payment.id];
                            if (!replacementWalletId) return;
                            replace.mutate({
                              batchId,
                              stagedPaymentId: payment.id,
                              replacementWalletId,
                            });
                          }}
                        >
                          Replace
                        </Button>
                      </div>
                    ) : (
                      <span className="block text-right text-xs text-muted-foreground">
                        No change allowed
                      </span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

function InvoiceCard({
  batchId,
  invoice,
  wallets,
  canReview,
}: {
  batchId: string;
  invoice: Invoice;
  wallets: Wallet[];
  canReview: boolean;
}) {
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [excludeReason, setExcludeReason] = useState("");
  const acknowledge = useAcknowledgeOfflineSalesWarning();
  const exclude = useExcludeOfflineSalesInvoice();
  const canExclude =
    invoice.status === "invalid" || invoice.status === "needs_review";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span className="font-mono">{invoice.invoiceNumber}</span>
          <Badge variant={statusVariant(invoice.status)}>
            {statusLabel(invoice.status)}
          </Badge>
        </CardTitle>
        <CardDescription>
          Invoices!{invoice.worksheetRowNumber} ·{" "}
          {invoice.saleType === "direct_distributor"
            ? "Direct distributor"
            : "Booked order"}{" "}
          ·{" "}
          {invoice.customerName ??
            invoice.distributorCode ??
            `Bill ${invoice.billNumber ?? "—"}`}{" "}
          · {dateTime(invoice.businessDate)}
        </CardDescription>
        <CardAction className="text-right">
          <p className="font-mono text-lg font-semibold">
            {PKR(invoice.invoiceAmount)}
          </p>
          <p className="text-xs text-muted-foreground">invoice total</p>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid gap-px border bg-border sm:grid-cols-3">
          <div className="bg-card p-3">
            <p className="text-xs text-muted-foreground">Paid Amount</p>
            <p className="font-medium tabular-nums">
              {PKR(invoice.paidAmount)}
            </p>
          </div>
          <div className="bg-card p-3">
            <p className="text-xs text-muted-foreground">
              Pending Verification
            </p>
            <p className="font-medium tabular-nums">
              {PKR(invoice.pendingAmount)}
            </p>
          </div>
          <div className="bg-card p-3">
            <p className="text-xs text-muted-foreground">Outstanding Amount</p>
            <p className="font-medium tabular-nums">
              {PKR(invoice.outstandingAmount)}
            </p>
          </div>
        </div>

        {invoice.issueDetails.length > 0 && (
          <Alert
            variant={invoice.status === "warning" ? "default" : "destructive"}
          >
            <HugeiconsIcon icon={AlertSquareIcon} strokeWidth={2} />
            <AlertTitle>Review these checks</AlertTitle>
            <AlertDescription>
              <ul className="flex list-disc flex-col gap-2 pl-4">
                {invoice.issueDetails.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>
                    {issue.source && (
                      <span className="font-mono font-medium">
                        {issue.source}:{" "}
                      </span>
                    )}
                    {issue.value !== undefined && (
                      <span>Entered “{issue.value || "blank"}”. </span>
                    )}
                    <span>{issue.message}</span>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        <OrderConflict batchId={batchId} invoice={invoice} />

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Products</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Excel row</TableHead>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Cartons</TableHead>
                <TableHead className="text-right">Loose units</TableHead>
                <TableHead className="text-right">Free cartons</TableHead>
                <TableHead className="text-right">Dispatched units</TableHead>
                <TableHead className="text-right">Line total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invoice.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>Items!{item.worksheetRowNumber}</TableCell>
                  <TableCell>{item.productName ?? item.productCode}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.cartonQuantity}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.looseUnitQuantity}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.freeCartons}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {item.dispatchedUnits}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {PKR(item.lineAmount)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Payments</h3>
          <PaymentTable
            batchId={batchId}
            invoice={invoice}
            wallets={wallets}
            canReview={canReview}
          />
        </div>
      </CardContent>
      {canReview && (invoice.status === "warning" || canExclude) && (
        <CardFooter className="justify-end gap-2">
          {canExclude && (
            <Button variant="outline" onClick={() => setExcludeOpen(true)}>
              Exclude invoice
            </Button>
          )}
          {invoice.status === "warning" && !invoice.warningsAcknowledged && (
            <Button
              disabled={acknowledge.isPending}
              onClick={() =>
                acknowledge.mutate({
                  batchId,
                  stagedInvoiceId: invoice.stagedInvoiceId,
                })
              }
            >
              {acknowledge.isPending && <Spinner data-icon="inline-start" />}I
              checked this warning
            </Button>
          )}
          {invoice.status === "warning" && invoice.warningsAcknowledged && (
            <Badge variant="default">Warning acknowledged</Badge>
          )}
        </CardFooter>
      )}

      <AlertDialog open={excludeOpen} onOpenChange={setExcludeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Exclude {invoice.invoiceNumber}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This invoice will not be posted. Its reserved offline invoice
              number remains in the audit history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <FieldGroup>
            <Field
              data-invalid={
                excludeReason.length > 0 && excludeReason.trim().length < 5
              }
            >
              <FieldLabel htmlFor={`exclude-${invoice.stagedInvoiceId}`}>
                Reason
              </FieldLabel>
              <Textarea
                id={`exclude-${invoice.stagedInvoiceId}`}
                value={excludeReason}
                aria-invalid={
                  excludeReason.length > 0 && excludeReason.trim().length < 5
                }
                placeholder="Explain why this invoice must not be posted"
                onChange={(event) => setExcludeReason(event.target.value)}
              />
            </Field>
          </FieldGroup>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={excludeReason.trim().length < 5 || exclude.isPending}
              onClick={(event) => {
                event.preventDefault();
                exclude.mutate(
                  {
                    batchId,
                    stagedInvoiceId: invoice.stagedInvoiceId,
                    reason: excludeReason.trim(),
                  },
                  { onSuccess: () => setExcludeOpen(false) },
                );
              }}
            >
              {exclude.isPending && <Spinner data-icon="inline-start" />}
              Exclude invoice
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function ReviewPanel({
  batchId,
  canReview,
  canPost,
}: {
  batchId: string | null;
  canReview: boolean;
  canPost: boolean;
}) {
  const batch = useOfflineSalesBatch(batchId);
  const wallets = useOfflineSalesReplacementWallets(canReview);
  const refresh = useRefreshOfflineSalesPreview();
  const post = usePostOfflineSalesBatch();

  if (!batchId) {
    return (
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={Database01Icon} strokeWidth={2} />
          </EmptyMedia>
          <EmptyTitle>Select an uploaded workbook</EmptyTitle>
          <EmptyDescription>
            Its invoices, products, payments, and warnings will appear here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }
  if (batch.isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }
  if (batch.isError || !batch.data) {
    return (
      <Alert variant="destructive">
        <HugeiconsIcon icon={AlertSquareIcon} strokeWidth={2} />
        <AlertTitle>Could not load review</AlertTitle>
        <AlertDescription>
          {batch.error instanceof Error
            ? batch.error.message
            : "Refresh and try again."}
        </AlertDescription>
      </Alert>
    );
  }
  const detail = batch.data;
  const eligible = detail.invoices.filter(
    (invoice) =>
      invoice.status === "ready" ||
      (invoice.status === "warning" && invoice.warningsAcknowledged),
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>{detail.filename}</CardTitle>
          <CardDescription>
            Outage {dateTime(detail.outageStartedAt)} to{" "}
            {dateTime(detail.outageEndedAt)} · {detail.outageReason}
          </CardDescription>
          <CardAction>
            <Badge variant="outline">
              {detail.status.replaceAll("_", " ")}
            </Badge>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Counts counts={detail.counts} />
        </CardContent>
        <CardFooter className="justify-end gap-2">
          {canReview && (
            <Button
              variant="outline"
              disabled={refresh.isPending}
              onClick={() => refresh.mutate({ batchId })}
            >
              <HugeiconsIcon
                icon={Refresh03Icon}
                strokeWidth={2}
                data-icon="inline-start"
              />
              Refresh live checks
            </Button>
          )}
          {canPost && (
            <Button
              disabled={eligible === 0 || post.isPending}
              onClick={() => post.mutate(batchId)}
            >
              {post.isPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <HugeiconsIcon
                  icon={Database01Icon}
                  strokeWidth={2}
                  data-icon="inline-start"
                />
              )}
              {post.isPending
                ? "Posting safely…"
                : `Post eligible invoices (${eligible})`}
            </Button>
          )}
        </CardFooter>
      </Card>

      {detail.counts.duplicate > 0 && (
        <Alert>
          <HugeiconsIcon icon={Database01Icon} strokeWidth={2} />
          <AlertTitle>
            {detail.counts.duplicate} duplicate invoice record
            {detail.counts.duplicate === 1 ? "" : "s"}
          </AlertTitle>
          <AlertDescription>
            These exact rows were uploaded earlier. They will not create another
            invoice.
          </AlertDescription>
        </Alert>
      )}

      <Separator />
      <div className="flex flex-col gap-4">
        {detail.invoices.map((invoice) => (
          <InvoiceCard
            key={invoice.stagedInvoiceId}
            batchId={batchId}
            invoice={invoice}
            wallets={wallets.data ?? []}
            canReview={canReview}
          />
        ))}
      </div>
    </div>
  );
}
