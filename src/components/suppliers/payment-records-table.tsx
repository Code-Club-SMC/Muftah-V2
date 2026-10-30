import { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/custom/data-table";
import { Button } from "../ui/button";
import { Eye } from "lucide-react";
import { useState } from "react";
import { PaymentDetailsDialog } from "./payment-details-dialog";
import { useQuery } from "@tanstack/react-query";
import { getWalletsListFn } from "@/server-functions/finance-fn";

// Resolve a walletId or legacy method value to a human-readable label
function resolveMethodLabel(walletId: string | null | undefined, method: string | null | undefined, wallets: { id: string; name: string }[]): string {
  // Prefer walletId (new schema)
  const id = walletId || method;
  if (!id) return "N/A";
  const known: Record<string, string> = {
    cash: "Cash",
    bank_transfer: "Bank Transfer",
    cheque: "Cheque",
    pay_later: "Pay Later",
  };
  if (known[id]) return known[id];
  const wallet = wallets.find((w) => w.id === id);
  return wallet ? wallet.name : "Finance Account";
}

type SupplierPayment = {
  id: string;
  createdAt: string | Date;
  paymentDate?: string | Date;
  amount: string;
  method: string | null;
  walletId: string | null;
  reference: string | null;
  bankName?: string | null;
  paidBy?: string | null;
  notes: string | null;
  purchase: {
    id: string; // Ensure ID is present
    materialType: string;
    chemical: { name: string } | null;
    packagingMaterial: { name: string } | null;
  } | null;
};

type Props = {
  data: SupplierPayment[];
  isLoading?: boolean;
  manualPagination?: boolean;
  pageCount?: number;
  pagination?: { pageIndex: number; pageSize: number };
  onPaginationChange?: (updater: any) => void;
  totalRecords?: number;
};

export const PaymentRecordsTable = ({ data, ...rest }: Props) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<SupplierPayment | null>(null);
  const { data: wallets = [] } = useQuery({ queryKey: ["wallets"], queryFn: getWalletsListFn });

  const columns: ColumnDef<SupplierPayment>[] = [
    {
      id: "date",
      header: "Date",
      cell: ({ row }) => (
        <span className="whitespace-nowrap">
          {format(
            new Date(row.original.paymentDate ?? row.original.createdAt),
            "MMM d, yyyy",
          )}
        </span>
      ),
    },
    {
      id: "material",
      header: "Material",
      cell: ({ row }) => {
        const purchase = row.original.purchase;
        if (!purchase) return <span className="text-muted-foreground">-</span>;
        const name =
          purchase.materialType === "chemical"
            ? purchase.chemical?.name
            : purchase.packagingMaterial?.name;
        return (
          <span className="font-medium whitespace-normal break-words min-w-[180px] block">
            {name || "-"}
          </span>
        );
      },
    },
    {
      accessorKey: "amount",
      header: "Amount",
      cell: ({ row }) => (
        <span className="font-bold text-green-600 dark:text-green-400">
          PKR{" "}
          {parseFloat(row.getValue("amount")).toLocaleString(undefined, {
            minimumFractionDigits: 2,
          })}
        </span>
      ),
    },
    {
      accessorKey: "method",
      header: "Method",
      cell: ({ row }) => (
        <Badge variant="outline" className="capitalize">
          {resolveMethodLabel(row.original.walletId, row.original.method, wallets)}
        </Badge>
      ),
    },
    {
      accessorKey: "paidBy",
      header: "Paid By",
      cell: ({ row }) => row.getValue("paidBy") || "-",
    },
    {
      accessorKey: "notes",
      header: "Notes",
      cell: ({ row }) => {
        const notes = row.getValue("notes") as string;
        return (
          <span className="max-w-[150px] truncate block" title={notes}>
            {notes || "-"}
          </span>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-indigo-500 hover:bg-indigo-50 hover:text-indigo-600 rounded-md transition-colors"
            onClick={() => {
              setSelectedPayment(row.original);
              setDetailsOpen(true);
            }}
          >
            <Eye className="size-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <DataTable
        columns={columns}
        data={data}
        searchKey="notes"
        searchPlaceholder="Search notes..."
        showPagination={!!rest.manualPagination}
        {...rest}
      />
      <PaymentDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        payment={selectedPayment}
      />
    </>
  );
};
