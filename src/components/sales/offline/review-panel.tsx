import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertSquareIcon,
  ArrowDown01Icon,
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
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { batchSource, batchStatusLabel, dateTime } from "./format";

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
  if (method === "expense_offset") return "Salary paid by distributor";
  return "Cash";
}

function saleTypeLabel(invoice: Invoice) {
  if (invoice.saleType === "direct_distributor") return "Direct distributor";
  if (invoice.saleType === "direct_retailer")
    return invoice.customerDetails ? "New retail customer" : "Retail customer";
  return "Booked order";
}

function quantity(item: Invoice["items"][number]) {
  const free = item.freeCartons + item.manualFreeCartons;
  return (
    [
      item.cartonQuantity > 0 &&
        `${item.cartonQuantity} carton${item.cartonQuantity === 1 ? "" : "s"}`,
      item.looseUnitQuantity > 0 && `${item.looseUnitQuantity} loose`,
      free > 0 && `${free} free`,
    ]
      .filter(Boolean)
      .join(" + ") || "—"
  );
}

// Invoices the reviewer still has to act on before the batch can post.
function needsAttention(invoice: Invoice) {
  return (
    invoice.status === "invalid" ||
    invoice.status === "needs_review" ||
    (invoice.status === "warning" && !invoice.warningsAcknowledged)
  );
}

function Counts({ counts }: { counts: OfflineSalesBatchDetail["counts"] }) {
  const values: Array<[Invoice["status"], number]> = [
    ["ready", counts.ready],
    ["warning", counts.warning],
    ["needs_review", counts.needsReview],
    ["invalid", counts.invalid],
    ["duplicate", counts.duplicate],
    ["posted", counts.posted],
    ["excluded", counts.excluded],
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">
        {counts.total} invoice{counts.total === 1 ? "" : "s"}:
      </span>
      {values
        .filter(([, value]) => value > 0)
        .map(([status, value]) => (
          <Badge key={status} variant={statusVariant(status)}>
            {value} {statusLabel(status)}
          </Badge>
        ))}
    </div>
  );
}

function Facts({ items }: { items: Array<[string, string]> }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="flex gap-1.5">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="font-medium tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
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
      <AlertTitle>This order already has an invoice</AlertTitle>
      <AlertDescription className="flex flex-col gap-4">
        <FieldGroup className="grid gap-4 lg:grid-cols-3">
          <Field>
            <FieldLabel>What happened?</FieldLabel>
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
                    Same delivery — exclude this offline invoice
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
              placeholder="What did you check?"
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

function Payments({
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

  if (invoice.payments.length === 0) {
    return <p className="text-sm text-muted-foreground">No payment yet.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Method</TableHead>
          <TableHead>Account</TableHead>
          <TableHead className="text-right">Amount</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {invoice.payments.map((payment) => {
          const requiredType = payment.method === "cash" ? "cash" : "bank";
          // A salary paid by the distributor goes through no account.
          const accountUnavailable =
            payment.method !== "expense_offset" &&
            payment.walletType !== requiredType;
          const choices = wallets.filter(
            (wallet) => wallet.type === requiredType,
          );
          const replacementWalletId = replacements[payment.id];
          const detail = [
            payment.reference ?? payment.chequeNumber,
            payment.method !== "cash" && payment.method !== "expense_offset"
              ? payment.instantVerify
                ? "verified instantly"
                : "pending verification"
              : null,
            payment.notes,
          ]
            .filter(Boolean)
            .join(" · ");
          return (
            <TableRow key={payment.id}>
              <TableCell>
                <span className="block">{paymentLabel(payment.method)}</span>
                {detail && (
                  <span className="text-xs text-muted-foreground">
                    {detail}
                  </span>
                )}
              </TableCell>
              <TableCell>
                {payment.method === "expense_offset" ? (
                  <span className="text-muted-foreground">
                    Settles an HR salary advance
                  </span>
                ) : (
                  <span className="block">
                    {payment.walletName ?? payment.walletCode}
                  </span>
                )}
                {accountUnavailable &&
                  (canReview ? (
                    <div className="mt-1 flex gap-2">
                      <Select
                        value={replacementWalletId ?? ""}
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
                        disabled={!replacementWalletId || replace.isPending}
                        onClick={() => {
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
                    <span className="text-xs text-destructive">
                      Needs a {requiredType} account
                    </span>
                  ))}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {PKR(payment.amount)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function InvoiceRow({
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
  const attention = needsAttention(invoice);
  const [open, setOpen] = useState(attention);
  const [excludeOpen, setExcludeOpen] = useState(false);
  const [excludeReason, setExcludeReason] = useState("");
  const acknowledge = useAcknowledgeOfflineSalesWarning();
  const exclude = useExcludeOfflineSalesInvoice();
  const canExclude =
    invoice.status === "invalid" || invoice.status === "needs_review";
  const canAcknowledge =
    invoice.status === "warning" && !invoice.warningsAcknowledged;
  const facts: Array<[string, string]> = [
    ["Paid", PKR(invoice.paidAmount)],
    ["Pending verification", PKR(invoice.pendingAmount)],
    ["Outstanding", PKR(invoice.outstandingAmount)],
  ];
  if (Number(invoice.invoiceDiscount) > 0)
    facts.push(["Discount", PKR(invoice.invoiceDiscount)]);
  if (Number(invoice.expenses) > 0)
    facts.push(["Freight and expenses", PKR(invoice.expenses)]);
  if (invoice.customerDetails)
    facts.push([
      "New customer (created when posted)",
      [
        invoice.customerDetails.name,
        invoice.customerDetails.mobile,
        invoice.customerDetails.city,
      ]
        .filter(Boolean)
        .join(" · "),
    ]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border bg-card">
      <CollapsibleTrigger className="group flex w-full items-center gap-3 p-3 text-left">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-medium">
              {invoice.invoiceNumber}
            </span>
            <Badge variant={statusVariant(invoice.status)}>
              {statusLabel(invoice.status)}
            </Badge>
            {invoice.status === "warning" && invoice.warningsAcknowledged && (
              <span className="text-xs text-muted-foreground">
                warning acknowledged
              </span>
            )}
          </div>
          <span className="truncate text-xs text-muted-foreground">
            {saleTypeLabel(invoice)} ·{" "}
            {invoice.customerName ??
              invoice.distributorCode ??
              `Bill ${invoice.billNumber ?? "—"}`}{" "}
            · {dateTime(invoice.businessDate)}
          </span>
        </div>
        <span className="font-mono font-semibold">
          {PKR(invoice.invoiceAmount)}
        </span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={2}
          className="shrink-0 transition-transform group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>

      <CollapsibleContent className="flex flex-col gap-4 border-t p-4">
        {invoice.issueDetails.length > 0 && (
          <Alert
            variant={invoice.status === "warning" ? "default" : "destructive"}
          >
            <HugeiconsIcon icon={AlertSquareIcon} strokeWidth={2} />
            <AlertTitle>Check this</AlertTitle>
            <AlertDescription>
              <ul className="flex list-disc flex-col gap-1 pl-4">
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

        {invoice.status === "duplicate" && (
          <p className="text-sm text-muted-foreground">
            Already received earlier. It will not create another invoice.
          </p>
        )}

        <OrderConflict batchId={batchId} invoice={invoice} />

        <Facts items={facts} />

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product</TableHead>
              <TableHead>Quantity</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoice.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>
                  {item.productName ?? item.productCode}
                  {item.isPriceOverride && (
                    <p className="text-xs text-amber-600">
                      Price changed from {PKR(item.listedCartonPrice ?? "0")} to{" "}
                      {PKR(item.baseCartonPrice)} per carton
                    </p>
                  )}
                </TableCell>
                <TableCell>
                  <span className="block">{quantity(item)}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.dispatchedUnits} units
                    {item.manualFreeCartons > 0 &&
                      ` · ${item.manualFreeCartons} free by hand`}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {PKR(item.lineAmount)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <Payments
          batchId={batchId}
          invoice={invoice}
          wallets={wallets}
          canReview={canReview}
        />

        {canReview && (canExclude || canAcknowledge) && (
          <div className="flex justify-end gap-2">
            {canExclude && (
              <Button variant="outline" onClick={() => setExcludeOpen(true)}>
                Exclude invoice
              </Button>
            )}
            {canAcknowledge && (
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
          </div>
        )}
      </CollapsibleContent>

      <AlertDialog open={excludeOpen} onOpenChange={setExcludeOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Exclude {invoice.invoiceNumber}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It will not be posted. The invoice number stays in the audit
              history.
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
                placeholder="Why must this invoice not be posted?"
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
    </Collapsible>
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
          <EmptyTitle>Nothing to review</EmptyTitle>
          <EmptyDescription>
            Invoices sent from the offline desk will show up here.
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
  const attention = detail.invoices.filter(needsAttention);
  const rest = detail.invoices.filter((invoice) => !needsAttention(invoice));
  const renderInvoice = (invoice: Invoice) => (
    <InvoiceRow
      key={invoice.stagedInvoiceId}
      batchId={batchId}
      invoice={invoice}
      wallets={wallets.data ?? []}
      canReview={canReview}
    />
  );

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <CardHeader>
          <CardTitle>
            {batchSource(detail.filename)} · {dateTime(detail.uploadedAt)}
          </CardTitle>
          <CardDescription>
            Outage {dateTime(detail.outageStartedAt)} to{" "}
            {dateTime(detail.outageEndedAt)} · {detail.outageReason}
          </CardDescription>
          <CardAction>
            <Badge variant="outline">{batchStatusLabel(detail.status)}</Badge>
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
                ? "Posting…"
                : `Post eligible invoices (${eligible})`}
            </Button>
          )}
        </CardFooter>
      </Card>

      {attention.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            Needs your attention ({attention.length})
          </h3>
          {attention.map(renderInvoice)}
        </section>
      )}
      {rest.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">
            {attention.length > 0 ? "No action needed" : "Invoices"} (
            {rest.length})
          </h3>
          {rest.map(renderInvoice)}
        </section>
      )}
    </div>
  );
}
