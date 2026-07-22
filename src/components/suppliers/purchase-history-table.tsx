import { ColumnDef } from "@tanstack/react-table";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/custom/data-table";
import { Button } from "../ui/button";
import {
  EyeIcon,
  PencilIcon,
  Trash2Icon,
  BanknoteIcon,
  MoreHorizontal,
  AlertTriangle,
  ShoppingCart,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export type PurchaseRecord = {
  id: string;
  createdAt: string | Date;
  cost: string;
  paidAmount: string;
  quantity: string;
  unitCost: string;
  materialType: string;
  paymentMethod?: string | null;
  currentStock?: number;
  isLowStock?: boolean;
  minStockLevel?: number;
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
  paidBy?: string | null;
  notes?: string | null;
  invoiceNumber?: string | null;
  transactionId?: string | null;
  // ... possibly other fields, use partial if uncertain, but we control the input
  lastPayment?: any; // For dialog
};

type Props = {
  data: PurchaseRecord[];
  setSelectedItem: (item: PurchaseRecord) => void;
  setDetailsOpen: (open: boolean) => void;
  setEditDialogOpen: (open: boolean) => void;
  setDeleteDialogOpen: (open: boolean) => void;
  onRecordPayment: (item: PurchaseRecord) => void;
  onRestock?: (item: PurchaseRecord) => void;
  dateRange?: { from?: Date; to?: Date };
  isLoading?: boolean;
  manualPagination?: boolean;
  pageCount?: number;
  pagination?: { pageIndex: number; pageSize: number };
  onPaginationChange?: (updater: any) => void;
  totalRecords?: number;
};

export const PurchaseHistoryTable = ({
  data,
  setSelectedItem,
  setDetailsOpen,
  setEditDialogOpen,
  setDeleteDialogOpen,
  onRecordPayment,
  onRestock,
  dateRange,
  ...rest
}: Props) => {
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

  const columns: ColumnDef<PurchaseRecord>[] = [
    {
      accessorKey: "createdAt",
      header: "Date",
      cell: ({ row }) => {
        const date = row.getValue("createdAt");
        if (!date) return "-";
        return (
          <div className="font-medium whitespace-nowrap">
            {format(new Date(date as string), "MMM d, yyyy")}
          </div>
        );
      },
    },
    {
      id: "material",
      header: "Material",
      accessorFn: (row) =>
        row.chemical?.name || row.packagingMaterial?.name || "Unknown",
      cell: ({ row }) => {
        const record = row.original;
        return (
          <div className="flex flex-col">
            <span className="font-medium text-sm truncate max-w-[150px]">
              {record.chemical?.name ||
                record.packagingMaterial?.name ||
                "Unknown"}
            </span>
            <Badge
              variant="outline"
              className="w-fit text-[10px] mt-0.5 capitalize h-5 px-1.5"
            >
              {record.materialType}
            </Badge>
          </div>
        );
      },
    },
    {
      accessorKey: "quantity",
      header: "Qty",
      cell: ({ row }) => {
        const record = row.original;
        const unit =
          record.chemical?.unit ||
          record.packagingMaterial?.capacityUnit ||
          "units";
        return (
          <span className="font-mono text-xs">
            {row.getValue("quantity")} {unit}
          </span>
        );
      },
    },
    {
      id: "stock",
      header: "Current Stock",
      cell: ({ row }) => {
        const record = row.original;
        if (record.currentStock === undefined)
          return <span className="text-muted-foreground">-</span>;

        const isLow = record.isLowStock;
        return (
          <div className="flex items-center gap-1.5">
            <span
              className={`font-mono font-medium text-xs ${isLow ? "text-red-500" : ""}`}
            >
              {record.currentStock}
            </span>
            {isLow && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger>
                    <AlertTriangle className="size-3.5 text-red-500" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Low Stock! Min: {record.minStockLevel}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
        );
      },
    },
    {
      id: "status",
      header: "Status",
      cell: ({ row }) => {
        const total = parseFloat(row.original.cost);
        const paid = parseFloat(row.original.paidAmount || "0");
        const remaining = total - paid;

        if (remaining <= 0.1)
          return (
            <Badge
              variant="default"
              className="bg-green-600 hover:bg-green-700 h-5 px-1.5 text-[10px]"
            >
              Paid
            </Badge>
          );
        if (paid > 0)
          return (
            <Badge
              variant="secondary"
              className="bg-yellow-100 text-yellow-800 hover:bg-yellow-200 h-5 px-1.5 text-[10px]"
            >
              Partial
            </Badge>
          );
        return (
          <Badge
            variant="outline"
            className="text-red-500 border-red-200 bg-red-50 h-5 px-1.5 text-[10px]"
          >
            Unpaid
          </Badge>
        );
      },
    },
    {
      accessorKey: "paidAmount",
      header: "Paid",
      cell: ({ row }) => (
        <span className="text-green-600 font-medium font-mono text-xs whitespace-nowrap">
          {parseFloat(row.getValue("paidAmount") || "0").toLocaleString(
            undefined,
            { minimumFractionDigits: 0, maximumFractionDigits: 0 },
          )}
        </span>
      ),
    },
    {
      id: "remaining",
      header: "Due",
      cell: ({ row }) => {
        const total = parseFloat(row.original.cost);
        const paid = parseFloat(row.original.paidAmount || "0");
        const remaining = total - paid;
        return (
          <span
            className={`font-mono text-xs whitespace-nowrap ${remaining > 0 ? "text-red-500 font-bold" : "text-muted-foreground"}`}
          >
            {remaining.toLocaleString(undefined, {
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            })}
          </span>
        );
      },
    },
    {
      id: "actions",
      cell: ({ row }) => {
        const record = row.original;
        const total = parseFloat(record.cost);
        const paid = parseFloat(record.paidAmount || "0");
        const remaining = total - paid;

        return (
          <div className="flex justify-end items-center gap-2">
            {onRestock && (
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs font-medium border-dashed"
                onClick={() => onRestock(record)}
              >
                <ShoppingCart className="size-3.5" />
                Buy Again
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-8 w-8 p-0">
                  <span className="sr-only">Open menu</span>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuItem
                  onClick={() => {
                    setSelectedItem(record);
                    setDetailsOpen(true);
                  }}
                >
                  <EyeIcon className="mr-2 h-4 w-4" />
                  View Details
                </DropdownMenuItem>
                {remaining > 0 && (
                  <DropdownMenuItem onClick={() => onRecordPayment(record)}>
                    <BanknoteIcon className="mr-2 h-4 w-4" />
                    Record Payment
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => {
                    setSelectedItem(record);
                    setEditDialogOpen(true);
                  }}
                >
                  <PencilIcon className="mr-2 h-4 w-4" />
                  Edit Record
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-red-600 focus:text-red-600"
                  onClick={() => {
                    setSelectedItem(record);
                    setDeleteDialogOpen(true);
                  }}
                >
                  <Trash2Icon className="mr-2 h-4 w-4" />
                  Delete Record
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];

  return (
    <DataTable
      columns={columns}
      data={filteredData}
      searchKey="material"
      searchPlaceholder="Filter purchases..."
      pageSize={5}
      {...rest}
    />
  );
};
