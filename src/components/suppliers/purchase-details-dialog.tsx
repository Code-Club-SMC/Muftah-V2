import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/components/custom/responsive-dialog";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Info } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { getWalletsListFn } from "@/server-functions/finance-fn";

function resolveMethodLabel(method: string | null | undefined, wallets: { id: string; name: string }[]): string {
  if (!method) return "N/A";
  const known: Record<string, string> = {
    cash: "Cash",
    bank_transfer: "Bank Transfer",
    cheque: "Cheque",
    pay_later: "Pay Later",
  };
  if (known[method]) return known[method];
  const wallet = wallets.find((w) => w.id === method);
  return wallet ? wallet.name : "Finance Account";
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchase: {
    id: string;
    createdAt: string | Date;
    cost: string;
    quantity: string;
    unitCost: string;
    paidAmount: string;
    paidBy?: string | null;
    materialType: string;
    chemical?: {
      id: string;
      name: string;
      unit: string;
      minimumStockLevel: string | null;
    } | null;
    packagingMaterial?: {
      id: string;
      name: string;
      type: string;
      capacity: string | null;
      capacityUnit: string | null;
      minimumStockLevel: number | null;
    } | null;
    paymentMethod?: string | null;
    transactionId?: string | null;
    invoiceNumber?: string | null;
    bankName?: string | null;
    notes?: string | null;
    lastPayment?: {
      id: string;
      createdAt: string | Date;
      amount: string;
      method: string | null;
      paidBy?: string | null;
      reference?: string | null;
      bankName?: string | null;
    } | null;
  } | null;
};

export const PurchaseDetailsDialog = ({
  open,
  onOpenChange,
  purchase,
}: Props) => {
  const { data: wallets = [] } = useQuery({ queryKey: ["wallets"], queryFn: getWalletsListFn });
  if (!purchase) return null;

  const itemName =
    purchase.chemical?.name ||
    purchase.packagingMaterial?.name ||
    "Unknown Item";
  const unit =
    purchase.chemical?.unit ||
    purchase.packagingMaterial?.capacityUnit ||
    "units";

  // Determine specific material details
  let materialDetails = null;
  if (purchase.chemical) {
    materialDetails = (
      <div className="text-xs text-muted-foreground mt-1 flex flex-col items-end gap-0.5">
        <span>Min Stock: {purchase.chemical.minimumStockLevel || "N/A"}</span>
      </div>
    );
  } else if (purchase.packagingMaterial) {
    materialDetails = (
      <div className="text-xs text-muted-foreground mt-1 flex flex-col items-end gap-0.5">
        <span>Type: {purchase.packagingMaterial.type}</span>
        <span>
          Capacity: {purchase.packagingMaterial.capacity}{" "}
          {purchase.packagingMaterial.capacityUnit}
        </span>
        <span>
          Min Stock: {purchase.packagingMaterial.minimumStockLevel || "N/A"}
        </span>
      </div>
    );
  }

  const paid = parseFloat(purchase.paidAmount || "0");
  const total = parseFloat(purchase.cost);
  const balance = total - paid;

  return (
    <ResponsiveDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Purchase Details"
      description={`Transaction ID: ${purchase.id}`}
      className="sm:max-w-2xl"
      icon={Info}
    >
      <div className="space-y-4 py-2">
        <div className="flex justify-between items-center">
          <span className="text-sm text-muted-foreground">Date</span>
          <span className="font-medium">
            {format(new Date(purchase.createdAt), "PPP p")}
          </span>
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex justify-between items-start">
            <span className="text-sm text-muted-foreground">Item</span>
            <div className="text-right">
              <p className="font-medium">{itemName}</p>
              <Badge variant="secondary" className="mt-1 capitalize">
                {purchase.materialType}
              </Badge>
              {materialDetails}
            </div>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Quantity</span>
            <span className="font-mono">
              {purchase.quantity} {unit}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Unit Cost</span>
            <span className="font-mono">
              PKR {parseFloat(purchase.unitCost).toLocaleString()}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Total Cost</span>
            <span className="font-bold text-green-600">
              PKR {total.toLocaleString()}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">Total Paid</span>
            <span className="font-bold text-blue-600">
              PKR {paid.toLocaleString()}
            </span>
          </div>

          {balance > 0 && (
            <div className="flex justify-between items-center bg-red-50 p-2 rounded">
              <span className="text-sm text-red-600 font-medium">
                Remaining Balance
              </span>
              <span className="font-bold text-red-600">
                PKR {balance.toLocaleString()}
              </span>
            </div>
          )}
        </div>

        <Separator />

        {/* Initial Payment Terms */}
        <div className="space-y-3">
          <h4 className="text-sm font-semibold text-foreground/80">
            Initial Payment Terms
          </h4>
          <div className="flex justify-between items-center">
            <span className="text-sm text-muted-foreground">
              Initial Method
            </span>
            <Badge variant="outline" className="capitalize">
              {resolveMethodLabel(purchase.paymentMethod, wallets)}
            </Badge>
          </div>
          {purchase.bankName && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">
                Initial Bank Name
              </span>
              <span className="font-medium">{purchase.bankName}</span>
            </div>
          )}
          {purchase.transactionId && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">
                Initial Ref / Trx ID
              </span>
              <span className="font-mono text-sm">
                {purchase.transactionId}
              </span>
            </div>
          )}
          {purchase.paidBy && (
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">
                Initially Paid By
              </span>
              <span className="font-medium">{purchase.paidBy}</span>
            </div>
          )}
        </div>

        {/* Latest Payment Details (if exists) */}
        {purchase.lastPayment && (
          <>
            <Separator />
            <div className="space-y-3">
              <h4 className="text-sm font-semibold text-foreground/80">
                Latest Payment Details
              </h4>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Date</span>
                <span className="font-medium text-xs">
                  {format(new Date(purchase.lastPayment.createdAt), "PPP p")}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">
                  Amount Paid
                </span>
                <span className="font-bold text-green-600">
                  PKR {parseFloat(purchase.lastPayment.amount).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Method</span>
                <Badge variant="outline" className="capitalize">
                  {resolveMethodLabel(purchase.lastPayment.method, wallets)}
                </Badge>
              </div>
              {purchase.lastPayment.paidBy && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Paid By</span>
                  <span className="font-medium">
                    {purchase.lastPayment.paidBy}
                  </span>
                </div>
              )}
              {purchase.lastPayment.reference && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">
                    Reference
                  </span>
                  <span className="font-mono text-sm">
                    {purchase.lastPayment.reference}
                  </span>
                </div>
              )}
            </div>
          </>
        )}

        {purchase.notes && (
          <div className="pt-2">
            <p className="text-sm font-medium mb-1">Notes</p>
            <div className="bg-muted/30 p-3 rounded-md text-sm text-muted-foreground">
              {purchase.notes}
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
