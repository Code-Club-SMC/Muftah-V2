import { useState } from "react";
import { DataTable } from "@/components/custom/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { useGetCustomers } from "@/hooks/sales/use-customers";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight, X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { GenericEmpty } from "@/components/custom/empty";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { CustomersEmptyIllustration } from "../illustrations/CustomersEmptyIllustration";
import { SalesEmptyIllustration } from "../illustrations/SalesEmptyIllustration";

const PKR = (v: number) =>
  `PKR ${v.toLocaleString("en-PK", { minimumFractionDigits: 2 })}`;

export const CustomersTable = () => {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const limit = 7;

  const { data } = useGetCustomers({ page, limit, search: search || undefined });

  const customers = data?.data || [];
  const pageCount = data?.pageCount || 1;
  const total = data?.total || 0;

  if (total === 0 && !search) {
    return (
      <GenericEmpty
        className="mt-30"
        icon={CustomersEmptyIllustration}
        title="No Customers Yet"
        description="Customers are created automatically when you generate invoices."
        ctaText="Create First Invoice"
        onAddChange={() => navigate({ to: "/sales/new-invoice", search: { orderId: undefined } })}
      />
    );
  }

  const columns: ColumnDef<any>[] = [
    {
      accessorKey: "name",
      header: "Customer",
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="font-semibold text-sm">{row.original.name}</span>
          {row.original.mobileNumber && (
            <span className="text-[11px] text-muted-foreground">{row.original.mobileNumber}</span>
          )}
        </div>
      ),
    },
    {
      accessorKey: "customerType",
      header: "Type",
      cell: ({ row }) => (
        <Badge
          variant="outline"
          className={cn(
            "capitalize text-xs",
            row.original.customerType === "distributor"
              ? "border-purple-200 text-purple-700 bg-purple-50"
              : "border-blue-200 text-blue-700 bg-blue-50",
          )}
        >
          {row.original.customerType}
        </Badge>
      ),
    },
    {
      accessorKey: "totalSale",
      header: "Total Sales",
      cell: ({ row }) => (
        <span className="tabular-nums text-sm font-medium">
          {PKR(Number(row.original.totalSale))}
        </span>
      ),
    },
    {
      accessorKey: "payment",
      header: "Total Paid",
      cell: ({ row }) => (
        <span className="tabular-nums text-sm font-medium text-green-600">
          {PKR(Number(row.original.payment))}
        </span>
      ),
    },
    {
      accessorKey: "credit",
      header: "Outstanding",
      cell: ({ row }) => {
        const val = Number(row.original.credit);
        return val > 0 ? (
          <Badge variant="destructive" className="tabular-nums font-semibold text-xs">
            {PKR(val)}
          </Badge>
        ) : (
          <Badge variant="outline" className="text-green-600 border-green-200 text-xs">
            Clear
          </Badge>
        );
      },
    },
  ];

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
          <Input
            placeholder="Search by name or mobile..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 h-9 text-sm"
          />
        </div>
        {search && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setSearch(""); setPage(1); }}
            className="gap-1.5 text-muted-foreground h-9"
          >
            <X className="size-3.5" /> Clear
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {total} customer{total !== 1 ? "s" : ""}
          {search && " found"}
        </span>
      </div>

      {/* Empty search state */}
      {total === 0 && search ? (
        <GenericEmpty
          className="py-12"
          icon={SalesEmptyIllustration}
          title="No Match Found"
          description={`We couldn't find any customers matching "${search}".`}
          ctaText="Clear Search"
          onAddChange={() => setSearch("")}
        />
      ) : (
        <>
          <DataTable columns={columns} data={customers} showSearch={false} showPagination={false} />

          {/* Pagination */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-muted-foreground tabular-nums">
              Page <strong>{page}</strong> of <strong>{pageCount}</strong>
            </span>
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline" size="sm" disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="h-8 px-3"
              >
                <ChevronLeft className="h-3.5 w-3.5 mr-0.5" /> Prev
              </Button>
              <Button
                variant="outline" size="sm" disabled={page >= pageCount}
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                className="h-8 px-3"
              >
                Next <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};