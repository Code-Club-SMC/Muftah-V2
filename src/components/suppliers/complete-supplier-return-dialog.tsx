import { useQuery } from "@tanstack/react-query";
import Big from "big.js";
import { FileCheck2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebitNotePreview, useSupplierReturnMutations } from "@/hooks/suppliers/use-supplier-returns";
import { formatRupees } from "@/lib/finance/expense-entry";
import { getWalletsListFn } from "@/server-functions/finance-fn";

const MONEY = /^\d+(\.\d{1,2})?$/;

export function CompleteSupplierReturnDialog({
  open,
  onOpenChange,
  returnId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnId: string | null;
}) {
  const { data: preview } = useDebitNotePreview(open ? returnId : null);
  const { data: wallets = [] } = useQuery({ queryKey: ["wallets"], queryFn: () => getWalletsListFn(), enabled: open });
  const { complete } = useSupplierReturnMutations();
  const [cashBack, setCashBack] = useState("");
  const [walletId, setWalletId] = useState("");

  useEffect(() => {
    if (!open) {
      setCashBack("");
      setWalletId("");
    }
  }, [open]);
  useEffect(() => {
    if (!walletId && wallets.length) setWalletId(wallets[0].id);
  }, [wallets, walletId]);

  if (!preview) {
    return (
      <ResponsiveDialog open={open} onOpenChange={onOpenChange} title="Complete return" description="Loading the debit note" icon={FileCheck2}>
        <Skeleton className="h-32" />
      </ResponsiveDialog>
    );
  }

  const leftover = new Big(preview.leftover);
  const cashValid = cashBack === "" || MONEY.test(cashBack);
  const cash = cashValid && cashBack ? new Big(cashBack) : new Big(0);
  const tooMuch = cash.gt(leftover);
  const credit = tooMuch ? new Big(0) : leftover.minus(cash);
  const owedAfter = new Big(preview.owedBefore).minus(preview.applied);
  const canSubmit = cashValid && !tooMuch && (cash.eq(0) || !!walletId) && !complete.isPending;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Complete return"
      description={`Debit note worth ${formatRupees(preview.value)} for ${preview.supplierName}`}
      icon={FileCheck2}
    >
      <FieldGroup>
        {new Big(preview.applied).gt(0) && (
          <p className="text-sm">
            {`What we owe on this purchase goes from ${formatRupees(preview.owedBefore)} to ${formatRupees(owedAfter.toFixed(2))}.`}
          </p>
        )}
        {leftover.gt(0) && (
          <>
            <p className="text-sm">{`${formatRupees(preview.leftover)} is more than this purchase still owes.`}</p>
            <Field>
              <FieldLabel htmlFor="cash-back">Cash back from supplier (PKR)</FieldLabel>
              <Input
                id="cash-back"
                inputMode="decimal"
                value={cashBack}
                onChange={(e) => setCashBack(e.target.value.trim())}
                placeholder="0"
              />
              {!cashValid && <FieldError>Enter an amount with at most 2 decimals</FieldError>}
              {tooMuch && <FieldError>{`Cash back can't be more than ${formatRupees(preview.leftover)}`}</FieldError>}
            </Field>
            {cash.gt(0) && (
              <Field>
                <FieldLabel>Into account</FieldLabel>
                <Select value={walletId} onValueChange={setWalletId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Pick an account" />
                  </SelectTrigger>
                  <SelectContent>
                    {wallets.map((w) => (
                      <SelectItem key={w.id} value={w.id}>
                        {w.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
            {credit.gt(0) && (
              <p className="text-sm text-muted-foreground">
                {`${formatRupees(credit.toFixed(2))} stays with ${preview.supplierName} as supplier credit`}
              </p>
            )}
          </>
        )}
        <Button
          disabled={!canSubmit}
          onClick={async () => {
            if (!returnId) return;
            await complete.mutateAsync({
              data: { id: returnId, ...(cash.gt(0) ? { cashBack, refundWalletId: walletId } : {}) },
            });
            onOpenChange(false);
          }}
        >
          Complete and issue debit note
        </Button>
      </FieldGroup>
    </ResponsiveDialog>
  );
}
