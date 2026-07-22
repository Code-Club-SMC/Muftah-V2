import { useNavigate } from "@tanstack/react-router";
import { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Eye, Trash2, Pencil } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { deleteSupplierFn } from "@/server-functions/suppliers/delete-supplier-fn";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { DataTable } from "@/components/custom/data-table";
import { useState } from "react";
import { EditSupplierDialog } from "./edit-supplier-dialog";
import { getSuppliersFn } from "@/server-functions/suppliers/get-suppliers-fn";

type Supplier = Awaited<ReturnType<typeof getSuppliersFn>>[0];

type Props = {
  data: Supplier[];
};

export const SuppliersTable = ({ data }: Props) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const deleteMutate = useMutation({
    mutationFn: deleteSupplierFn,
    onSuccess: () => {
      toast.success("Supplier deleted");
      queryClient.invalidateQueries({ queryKey: ["suppliers"] });
    },
    onError: () => toast.error("Failed to delete supplier"),
  });

  const columns: ColumnDef<Supplier>[] = [
    {
      accessorKey: "supplierName",
      header: "Supplier Name",
      cell: ({ row }) => (
        <span className="font-medium text-foreground">
          {row.original.supplierName}
        </span>
      ),
    },
    {
      accessorKey: "supplierShopName",
      header: "Shop Name",
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {row.original.supplierShopName || "-"}
        </span>
      ),
    },
    {
      accessorKey: "nationalId",
      header: "National ID",
      cell: ({ row }) => (
        <span className="font-mono text-xs">
          {row.original.nationalId || "-"}
        </span>
      ),
    },
    {
      id: "contactDetails",
      header: "Contact Details",
      cell: ({ row }) => {
        const email = row.original.email;
        const phone = row.original.phone;
        return (
          <div className="flex flex-col text-sm">
            <span>{email || "-"}</span>
            <span className="text-muted-foreground text-xs">
              {phone || "-"}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "balance",
      header: "Balance",
      cell: ({ row }) => {
        const balance = row.original.balance;
        return (
          <span
            className={`font-mono font-bold ${balance > 0 ? "text-rose-600" : "text-emerald-600"}`}
          >
            PKR {balance.toLocaleString()}
          </span>
        );
      },
    },
    {
      id: "actions",
      header: () => <div className="text-right">Actions</div>,
      cell: ({ row }) => {
        const supplier = row.original;
        return (
          <div
            className="flex justify-end gap-2"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate({ to: `/suppliers/${supplier.id}` })}
            >
              <Eye className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="text-primary hover:text-primary hover:bg-primary/10"
              onClick={() => setEditingSupplier(supplier)}
            >
              <Pencil className="size-4" />
            </Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="size-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This will permanently delete the supplier "
                    {supplier.supplierName}". This action requires that the
                    supplier has no associated active transactions.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    onClick={() =>
                      deleteMutate.mutate({ data: { id: supplier.id } })
                    }
                  >
                    Delete
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        );
      },
    },
  ];

  return (
    <>
      <DataTable
        pageSize={20}
        columns={columns}
        data={data}
        searchKey="supplierName"
        searchPlaceholder="Filter suppliers..."
      />
      {editingSupplier && (
        <EditSupplierDialog
          open={!!editingSupplier}
          onOpenChange={(open) => !open && setEditingSupplier(null)}
          supplier={editingSupplier}
        />
      )}
    </>
  );
};
