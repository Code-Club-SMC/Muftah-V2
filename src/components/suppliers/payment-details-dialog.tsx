import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Info } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getWalletsListFn } from "@/server-functions/finance-fn";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  payment: {
    id: string;
    createdAt: string | Date;
    amount: string;
    method: string | null;
    walletId?: string | null;
    reference: string | null;
    bankName?: string | null;
    paidBy?: string | null;
    notes: string | null;
    purchase: {
      materialType: string;
      chemical: { name: string } | null;
      packagingMaterial: { name: string } | null;
      id: string;
    } | null;
  } | null;
};

export const PaymentDetailsDialog = ({
  open,
  onOpenChange,
  payment,
}: Props) => {
  if (!payment) return null;

  const { data: wallets = [] } = useQuery({ queryKey: ["wallets"], queryFn: getWalletsListFn });

  const known: Record<string, string> = {
    cash: "Cash",
    bank_transfer: "Bank Transfer",
    cheque: "Cheque",
    pay_later: "Pay Later",
  };
  const id = payment.walletId || payment.method;
  const methodLabel = id
    ? (known[id] ?? wallets.find((w) => w.id === id)?.name ?? "Finance Account")
    : "N/A";

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Payment Details"
      description={`Transaction ID: ${payment.id}`}
      icon={Info}
    >
      <div className="space-y-4 py-2">
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Date</span>
          <span className="font-medium">
            {format(new Date(payment.createdAt), "PPP p")}
          </span>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Amount Paid</span>
            <span className="font-bold text-green-600 text-lg">
              PKR{" "}
              {parseFloat(payment.amount).toLocaleString(undefined, {
                minimumFractionDigits: 2,
              })}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              Payment Method
            </span>
            <Badge variant="outline" className="capitalize">
              {methodLabel}
            </Badge>
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          {payment.purchase && (
            <div className="flex justify-between items-start">
              <span className="text-sm text-muted-foreground">
                Related Purchase
              </span>
              <div className="text-right">
                <p className="font-medium text-sm">
                  {payment.purchase.chemical?.name ||
                    payment.purchase.packagingMaterial?.name ||
                    "Unknown Item"}
                </p>
                <span className="text-xs text-muted-foreground block">
                  ID: {payment.purchase.id}
                </span>
              </div>
            </div>
          )}

          {payment.bankName && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Bank Name</span>
              <span className="font-medium">{payment.bankName}</span>
            </div>
          )}

          {payment.reference && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">
                Reference / Cheque #
              </span>
              <span className="font-mono text-sm">{payment.reference}</span>
            </div>
          )}

          {payment.paidBy && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Paid By</span>
              <span className="font-medium">{payment.paidBy}</span>
            </div>
          )}
        </div>

        {payment.notes && (
          <div className="pt-2">
            <p className="text-sm font-medium mb-1">Notes</p>
            <div className="bg-muted/30 p-3 rounded-md text-sm text-muted-foreground">
              {payment.notes}
            </div>
          </div>
        )}

        <div className="flex justify-end pt-4">
          <Button onClick={() => onOpenChange(false)}>Close</Button>
        </div>
      </div>
    </ResponsiveDialog>
  );
};
