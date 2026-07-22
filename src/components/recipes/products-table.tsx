import { Trash2, ArrowUpDown, Plus, Pencil, Eye } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { useState, useMemo } from "react";
import { useProductActions } from "@/hooks/inventory/use-product-actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { EditProductDialog } from "@/components/recipes/edit-product-dialog";
import { DataTable } from "../custom/data-table";
import { ColumnDef } from "@tanstack/react-table";
import { AddProductDialog } from "./add-product-dialog";

type Product = {
  id: string;
  name: string;
  description: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
  recipes?: any[]; // Added to support recipe count
};

type ProductsTableProps = {
  products: Product[];
};

export const ProductsTable = ({ products }: ProductsTableProps) => {
  const navigate = useNavigate();
  const [addProductOpen, setAddProductOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const { deleteProduct } = useProductActions();

  const handleDelete = async () => {
    if (selectedProduct) {
      await deleteProduct.mutateAsync({ data: { id: selectedProduct.id } });
      setDeleteDialogOpen(false);
      setSelectedProduct(null);
    }
  };

  const columns = useMemo<ColumnDef<Product>[]>(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => {
          return (
            <Button
              variant="ghost"
              onClick={() =>
                column.toggleSorting(column.getIsSorted() === "asc")
              }
              className="-ml-4 h-8 text-[10px] font-bold uppercase  hover:bg-transparent"
            >
              Product Name
              <ArrowUpDown className="ml-2 h-3 w-3" />
            </Button>
          );
        },
        cell: ({ row }) => (
          <div className="font-bold text-foreground py-1">
            {row.getValue("name")}
          </div>
        ),
      },
      {
        accessorKey: "description",
        header: "DESCRIPTION",
        cell: ({ row }) => (
          <div className="text-muted-foreground text-xs font-medium max-w-[300px] truncate leading-relaxed">
            {(row.getValue("description") as string) ||
              "No description provided"}
          </div>
        ),
      },
      {
        id: "costPerUnit",
        header: "COST/UNIT",
        cell: ({ row }) => {
          const recipe = row.original.recipes?.[0]; // Show cost of the first/primary recipe
          if (!recipe)
            return <span className="text-xs text-muted-foreground">-</span>;

          return (
            <div className="flex flex-col">
              <span className="text-xs font-bold text-green-700">
                PKR{" "}
                {parseFloat(recipe.estimatedCostPerContainer || "0").toFixed(2)}
              </span>
              <span className="text-[9px] uppercase text-muted-foreground font-medium">
                Est. Cost
              </span>
            </div>
          );
        },
      },
      {
        id: "recipesCount",
        header: "RECIPES COUNT",
        cell: ({ row }) => {
          const count = row.original.recipes?.length || 0;
          return (
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold font-mono">{count}</span>
              <span className="text-[10px] uppercase text-muted-foreground">
                Recipes
              </span>
            </div>
          );
        },
      },
      {
        id: "actions",
        cell: ({ row }) => (
          <div className="flex justify-end gap-1.5 opacity-60 group-hover:opacity-100 transition-opacity">
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-blue-500 hover:bg-blue-50 hover:text-blue-600 rounded-md transition-colors"
              onClick={() => {
                navigate({ to: `/manufacturing/products/${row.original.id}` });
              }}
            >
              <Eye className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-slate-500 hover:bg-slate-100 hover: rounded-md transition-colors"
              onClick={() => {
                setSelectedProduct(row.original);
                setEditDialogOpen(true);
              }}
            >
              <Pencil className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 text-rose-500 hover:bg-rose-50 hover:text-rose-600 rounded-md transition-colors"
              onClick={() => {
                setSelectedProduct(row.original);
                setDeleteDialogOpen(true);
              }}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center bg-muted/30 p-4 rounded-lg border border-border/50">
        <div>
          <h3 className="text-lg font-semibold tracking-tight">
            Product Catalog
          </h3>
          <p className="text-sm text-muted-foreground">
            Manage and monitor your products stock levels.
          </p>
        </div>
        <Button onClick={() => setAddProductOpen(true)}>
          <Plus className="size-4 mr-2" />
          Add Product
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={products}
        searchKey="name"
        searchPlaceholder="Filter products..."
      />

      <AddProductDialog
        open={addProductOpen}
        onOpenChange={setAddProductOpen}
      />

      {selectedProduct && (
        <EditProductDialog
          open={editDialogOpen}
          onOpenChange={setEditDialogOpen}
          product={selectedProduct}
        />
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the product{" "}
              <strong>{selectedProduct?.name}</strong> and all its associated
              recipes. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedProduct(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleteProduct.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteProduct.isPending ? "Deleting..." : "Delete Product"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
