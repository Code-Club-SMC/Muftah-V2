import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useSuspenseQuery, useQuery, keepPreviousData } from "@tanstack/react-query";
import { getSupplierPaginatedPurchasesFn } from "@/server-functions/suppliers/get-supplier-paginated-purchases-fn";
import { getSupplierPaginatedPaymentsFn } from "@/server-functions/suppliers/get-supplier-paginated-payments-fn";
import { getSupplierPaginatedOutstandingFn } from "@/server-functions/suppliers/get-supplier-paginated-outstanding-fn";
import { getSupplierDetailsFn } from "@/server-functions/suppliers/get-supplier-details-fn";
import { z } from "zod";
import { Card } from "@/components/ui/card";
import { PurchaseHistoryTable } from "@/components/suppliers/purchase-history-table";
import { PaymentRecordsTable } from "@/components/suppliers/payment-records-table";
import { DatePickerWithRange } from "@/components/custom/date-range-picker";
import { Button } from "@/components/ui/button";
import { ArrowLeft, XIcon, TrendingUp, Banknote, CreditCard, Building2 } from "lucide-react";
import { DateRange } from "react-day-picker";
import { useState } from "react";
import { GenericLoader } from "@/components/custom/generic-loader";
import { PurchaseDetailsDialog } from "@/components/suppliers/purchase-details-dialog";
import { DeletePurchaseDialog } from "@/components/suppliers/delete-purchase-dialog";
import { RecordPaymentDialog } from "@/components/suppliers/record-payment-dialog";
import { AddStockDialog } from "@/components/inventory/add-stock-dialog";
import { getInventoryFn } from "@/server-functions/inventory/get-inventory-fn";
import { AddRawMaterialDialog } from "@/components/inventory/add-raw-material-sheet";
import { AddPackagingMaterialSheet } from "@/components/inventory/add-packaging-material-sheet";


const searchSchema = z.object({
  view: z.enum(["purchases", "payments", "outstanding"]).catch("purchases"),
  page: z.number().catch(1),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export const Route = createFileRoute(
  "/_protected/suppliers/$supplierId_/details",
)({
  validateSearch: searchSchema,
  loaderDeps: ({ search: { view, page, dateFrom, dateTo } }) => ({
    view,
    page,
    dateFrom,
    dateTo,
  }),
  loader: async ({ context, params, deps }) => {
    // We fetch the supplier details briefly just for the header naming
    context.queryClient.ensureQueryData({
      queryKey: ["supplier", params.supplierId],
      queryFn: () => getSupplierDetailsFn({ data: { id: params.supplierId } }),
    });
    
    // We only fetch the requested view
    if (deps.view === "purchases") {
      await context.queryClient.ensureQueryData({
        queryKey: ["paginated-purchases", params.supplierId, deps.page, deps.dateFrom, deps.dateTo],
        queryFn: () =>
          getSupplierPaginatedPurchasesFn({
            data: {
              supplierId: params.supplierId,
              page: deps.page,
              limit: 25,
              dateFrom: deps.dateFrom,
              dateTo: deps.dateTo,
            },
          }),
      });
    } else if (deps.view === "payments") {
      await context.queryClient.ensureQueryData({
        queryKey: ["paginated-payments", params.supplierId, deps.page, deps.dateFrom, deps.dateTo],
        queryFn: () =>
          getSupplierPaginatedPaymentsFn({
            data: {
              supplierId: params.supplierId,
              page: deps.page,
              limit: 25,
              dateFrom: deps.dateFrom,
              dateTo: deps.dateTo,
            },
          }),
      });
    } else if (deps.view === "outstanding") {
      await context.queryClient.ensureQueryData({
        queryKey: ["paginated-outstanding", params.supplierId, deps.page, deps.dateFrom, deps.dateTo],
        queryFn: () =>
          getSupplierPaginatedOutstandingFn({
            data: {
              supplierId: params.supplierId,
              page: deps.page,
              limit: 25,
              dateFrom: deps.dateFrom,
              dateTo: deps.dateTo,
            },
          }),
      });
    }
  },
  pendingComponent: () => <GenericLoader title="Loading Records" />,
  component: DetailsPage,
});

function DetailsPage() {
  const { supplierId } = Route.useParams();
  const searchParams = Route.useSearch();
  const navigate = useNavigate();

  const { data: supplier } = useSuspenseQuery({
    queryKey: ["supplier", supplierId],
    queryFn: () => getSupplierDetailsFn({ data: { id: supplierId } }),
  });

  const { data: warehouses } = useSuspenseQuery({
    queryKey: ["inventory"],
    queryFn: getInventoryFn,
  });

  // Table Data based on View
  let tableData: any = [];
  let metadata = { totalRecords: 0, totalPages: 1, currentPage: 1 };
  let isFetchingData = false;

  const purchasesQuery = useQuery({
    queryKey: ["paginated-purchases", supplierId, searchParams.page, searchParams.dateFrom, searchParams.dateTo],
    queryFn: () =>
      getSupplierPaginatedPurchasesFn({
        data: {
          supplierId,
          page: searchParams.page,
          limit: 25,
          dateFrom: searchParams.dateFrom,
          dateTo: searchParams.dateTo,
        },
      }),
    enabled: searchParams.view === "purchases",
    placeholderData: keepPreviousData,
  });

  const paymentsQuery = useQuery({
    queryKey: ["paginated-payments", supplierId, searchParams.page, searchParams.dateFrom, searchParams.dateTo],
    queryFn: () =>
      getSupplierPaginatedPaymentsFn({
        data: {
          supplierId,
          page: searchParams.page,
          limit: 25,
          dateFrom: searchParams.dateFrom,
          dateTo: searchParams.dateTo,
        },
      }),
    enabled: searchParams.view === "payments",
    placeholderData: keepPreviousData,
  });

  const outstandingQuery = useQuery({
    queryKey: ["paginated-outstanding", supplierId, searchParams.page, searchParams.dateFrom, searchParams.dateTo],
    queryFn: () =>
      getSupplierPaginatedOutstandingFn({
        data: {
          supplierId,
          page: searchParams.page,
          limit: 25,
          dateFrom: searchParams.dateFrom,
          dateTo: searchParams.dateTo,
        },
      }),
    enabled: searchParams.view === "outstanding",
    placeholderData: keepPreviousData,
  });

  if (searchParams.view === "purchases" && purchasesQuery.data) {
    tableData = purchasesQuery.data.data;
    metadata = purchasesQuery.data.metadata;
    isFetchingData = purchasesQuery.isFetching;
  } else if (searchParams.view === "payments" && paymentsQuery.data) {
    tableData = paymentsQuery.data.data;
    metadata = paymentsQuery.data.metadata;
    isFetchingData = paymentsQuery.isFetching;
  } else if (searchParams.view === "outstanding" && outstandingQuery.data) {
    tableData = outstandingQuery.data.data;
    metadata = outstandingQuery.data.metadata;
    isFetchingData = outstandingQuery.isFetching;
  }

  const handleDateChange = (range: DateRange | undefined) => {
    navigate({
      from: Route.fullPath,
      search: (prev) => ({
        ...prev,
        page: 1, // Reset page on filter change
        dateFrom: range?.from?.toISOString(),
        dateTo: range?.to?.toISOString(),
      }),
    });
  };

  const setPage = (newPage: number) => {
    navigate({
      from: Route.fullPath,
      search: (prev) => ({
        ...prev,
        page: newPage,
      }),
    });
  };

  const paginationProps = {
    manualPagination: true,
    pageCount: metadata.totalPages,
    totalRecords: metadata.totalRecords,
    isLoading: isFetchingData,
    pagination: { pageIndex: metadata.currentPage - 1, pageSize: 25 },
    onPaginationChange: (updater: any) => {
       const newIndex = typeof updater === "function" ? updater({ pageIndex: metadata.currentPage - 1, pageSize: 25 }).pageIndex : updater.pageIndex;
       setPage(newIndex + 1);
    }
  };

  // States for dialogs
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isRecordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [isRestockOpen, setRestockOpen] = useState(false);
  const [paymentDefaults, setPaymentDefaults] = useState<any>({});

  const handleRecordPayment = (item: any) => {
    const total = parseFloat(item.cost);
    const paid = parseFloat(item.paidAmount || "0");
    const remaining = total - paid;
    setPaymentDefaults({
      amount: remaining.toString(),
      purchaseId: item.id,
      remainingBalance: remaining,
      notes: `Payment for Purchase ID: ${item.id} (${item.materialType})`,
    });
    setRecordPaymentOpen(true);
  };

  // Convert Date strings to Date objects for the picker
  const currentRange = {
    from: searchParams.dateFrom ? new Date(searchParams.dateFrom) : undefined,
    to: searchParams.dateTo ? new Date(searchParams.dateTo) : undefined,
  };

  return (
    <div className="space-y-6 pb-8">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="icon" asChild>
            <Link to="/suppliers/$supplierId" params={{ supplierId }}>
              <ArrowLeft className="size-4" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight leading-none">
                {searchParams.view === "purchases" && "Total Purchases History"}
                {searchParams.view === "payments" && "Payment Records"}
                {searchParams.view === "outstanding" && "Outstanding Balance Details"}
              </h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1 flex items-center gap-1.5">
              <Building2 className="size-3.5" /> {supplier.supplierName} 
              <span className="opacity-50 mx-1">•</span> 
              Viewing complete paginated records
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <DatePickerWithRange
            date={currentRange}
            onDateChange={handleDateChange}
            className="w-[260px] h-9"
          />
          {currentRange.from && (
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-muted-foreground hover:text-foreground"
              onClick={() => handleDateChange(undefined)}
            >
              <XIcon className="size-4" />
            </Button>
          )}
        </div>
      </div>

      {/* ── Tabs (Navigation) ── */}
      <div className="flex gap-2">
        <Button
          variant={searchParams.view === "purchases" ? "default" : "outline"}
          onClick={() => navigate({ from: Route.fullPath, search: (prev) => ({ ...prev, view: "purchases", page: 1 }) })}
          className="h-9"
        >
          <TrendingUp className="size-4 mr-2" />
          Purchases
        </Button>
        <Button
          variant={searchParams.view === "payments" ? "default" : "outline"}
          onClick={() => navigate({ from: Route.fullPath, search: (prev) => ({ ...prev, view: "payments", page: 1 }) })}
          className="h-9"
        >
          <Banknote className="size-4 mr-2" />
          Payments
        </Button>
        <Button
          variant={searchParams.view === "outstanding" ? "default" : "outline"}
          onClick={() => navigate({ from: Route.fullPath, search: (prev) => ({ ...prev, view: "outstanding", page: 1 }) })}
          className={searchParams.view === "outstanding" 
            ? "h-9 bg-red-600 text-white hover:bg-red-700" 
            : "h-9 text-red-600 hover:text-red-700 hover:bg-red-50 border-red-200"
          }
        >
          <CreditCard className="size-4 mr-2" />
          Outstanding
        </Button>
      </div>

      <Card>
        <div className="p-1">
          {searchParams.view === "purchases" || searchParams.view === "outstanding" ? (
             <PurchaseHistoryTable
                data={tableData}
                setSelectedItem={setSelectedItem}
                setDetailsOpen={setDetailsOpen}
                setEditDialogOpen={setEditDialogOpen}
                setDeleteDialogOpen={setDeleteDialogOpen}
                onRecordPayment={handleRecordPayment}
                onRestock={(record) => {
                  setSelectedItem(record);
                  setRestockOpen(true);
                }}
                {...paginationProps}
             />
          ) : (
             <PaymentRecordsTable
                data={tableData}
                {...paginationProps}
             />
          )}
        </div>
      </Card>

      <RecordPaymentDialog
        open={isRecordPaymentOpen}
        onOpenChange={(open) => {
          setRecordPaymentOpen(open);
          if (!open) setPaymentDefaults({});
        }}
        supplierId={supplier.id}
        supplierName={supplier.supplierName}
        outstandingBalance={paymentDefaults.remainingBalance || 0}
        purchaseId={paymentDefaults.purchaseId}
        defaultAmount={paymentDefaults.amount}
        defaultNotes={paymentDefaults.notes}
      />
      <PurchaseDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        purchase={selectedItem}
      />
      <DeletePurchaseDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        purchase={selectedItem}
      />
      {selectedItem?.materialType === "chemical" && (
        <AddRawMaterialDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          warehouses={warehouses}
          preselectedWarehouse={warehouses.find((w) => w.type === "factory_floor")?.id}
          preselectedSupplierId={supplier.id}
          initialValues={selectedItem ? {
            purchaseId: selectedItem.id,
            name: selectedItem.chemical?.name || "",
            quantity: selectedItem.quantity,
            unitCost: selectedItem.unitCost,
            paidAmount: selectedItem.paidAmount,
            minimumStockLevel: selectedItem.chemical?.minimumStockLevel || "0",
            unit: (selectedItem.chemical?.unit === "liters" ? "liters" : "kg") as "kg" | "liters",
            packagingType: selectedItem.chemical?.packagingType || "",
            packagingSize: selectedItem.chemical?.packagingSize || "",
            notes: selectedItem.notes || "",
            invoiceNumber: selectedItem.invoiceNumber || "",
            transactionId: selectedItem.transactionId || "",
            paymentMethod: selectedItem.paymentMethod || "pay_later",
            paymentStatus: (() => {
              const paid = parseFloat(selectedItem.paidAmount || "0");
              const total = parseFloat(selectedItem.cost || "0");
              if (total <= 0 || paid <= 0) return "unpaid";
              if (paid >= total) return "paid";
              return "partial";
            })() as "paid" | "partial" | "unpaid",
            supplierId: supplier.id,
            warehouseId: warehouses.find((w) => w.type === "factory_floor")?.id,
          } : undefined}
        />
      )}
      {selectedItem?.materialType === "packaging" && (
        <AddPackagingMaterialSheet
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          warehouses={warehouses}
          preselectedWarehouse={warehouses.find((w) => w.type === "factory_floor")?.id}
          preselectedSupplierId={supplier.id}
          initialValues={selectedItem ? {
            purchaseId: selectedItem.id,
            name: selectedItem.packagingMaterial?.name || "",
            quantity: selectedItem.quantity,
            unitCost: selectedItem.unitCost,
            paidAmount: selectedItem.paidAmount,
            minimumStockLevel: selectedItem.packagingMaterial?.minimumStockLevel || 0,
            type: (selectedItem.packagingMaterial?.type || "primary") as "primary" | "master" | "sticker" | "extra",
            capacity: selectedItem.packagingMaterial?.capacity || "",
            capacityUnit: selectedItem.packagingMaterial?.capacityUnit || "",
            notes: selectedItem.notes || "",
            invoiceNumber: selectedItem.invoiceNumber || "",
            transactionId: selectedItem.transactionId || "",
            paymentMethod: selectedItem.paymentMethod || "pay_later",
            paymentStatus: (() => {
              const paid = parseFloat(selectedItem.paidAmount || "0");
              const total = parseFloat(selectedItem.cost || "0");
              if (total <= 0 || paid <= 0) return "unpaid";
              if (paid >= total) return "paid";
              return "partial";
            })() as "paid" | "partial" | "unpaid",
            supplierId: supplier.id,
            warehouseId: warehouses.find((w) => w.type === "factory_floor")?.id,
          } : undefined}
        />
      )}
      <AddStockDialog
        open={isRestockOpen}
        onOpenChange={setRestockOpen}
        warehouses={warehouses}
        preselectedWarehouse={warehouses.find((w) => w.type === "factory_floor")?.id}
        itemToRestock={selectedItem}
        preselectedSupplierId={supplier.id}
      />
    </div>
  );
}
