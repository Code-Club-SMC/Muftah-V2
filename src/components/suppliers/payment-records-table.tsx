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
  dateRange?: { from?: Date; to?: Date };
  isLoading?: boolean;
  manualPagination?: boolean;
  pageCount?: number;
  pagination?: { pageIndex: number; pageSize: number };
  onPaginationChange?: (updater: any) => void;
  totalRecords?: number;
};

export const PaymentRecordsTable = ({ data, dateRange, ...rest }: Props) => {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedPayment, setSelectedPayment] = useState<SupplierPayment | null>(null);
  const { data: wallets = [] } = useQuery({ queryKey: ["wallets"], queryFn: getWalletsListFn });

  // Filter data based on date range
  const filteredData = data.filter((record) => {
    if (!dateRange?.from) return true;
    const recordDate = new Date(record.createdAt);
    const from = new Date(dateRange.from);
    const to = dateRange.to ? new Date(dateRange.to) : from;

    // Normalize times
    recordDate.setHours(0, 0, 0, 0);
    from.setHours(0, 0, 0, 0);
    to.setHours(23, 59, 59, 999);

    return recordDate >= from && recordDate <= to;
  });

  const columns: ColumnDef<SupplierPayment>[] = [
    {
      accessorKey: "createdAt",
      header: "Date",
      cell: ({ row }) =>
        format(new Date(row.getValue("createdAt") as string), "MMM d, yyyy"),
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
        return <span className="font-medium">{name || "-"}</span>;
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
        data={filteredData}
        searchKey="notes"
        searchPlaceholder="Search notes..."
        pageSize={6}
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
