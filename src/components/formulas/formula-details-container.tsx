import { useSuspenseQuery } from "@tanstack/react-query";
import { getFormulaByIdFn } from "@/server-functions/manufacturing/formulas/get-formula-by-id-fn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatNum } from "@/lib/utils";
import { DataTable } from "@/components/custom/data-table";
import type { ColumnDef } from "@tanstack/react-table";
import { CreateFormulaDialog } from "./create-formula-dialog";
import { useViewerAccess } from "@/hooks/use-viewer-access";
import { hasPermission } from "@/lib/rbac";
import { useDeleteFormula } from "@/hooks/manufacturing/formulas/use-formula-mutations";
import { Button } from "@/components/ui/button";

type FormulaIngredient = any;

const ingredientColumns: ColumnDef<FormulaIngredient>[] = [
  {
    accessorKey: "chemical.name",
    header: "Chemical",
  },
  {
    accessorKey: "quantityPerBatch",
    header: "Quantity",
    cell: ({ row }) =>
      `${row.original.quantityPerBatch} ${row.original.chemical?.unit}`,
  },
  {
    accessorKey: "cost",
    header: "Est. Cost",
    cell: ({ row }) => {
      const costPerUnit = Number(row.original.chemical?.costPerUnit || 0);
      const qty = Number(row.original.quantityPerBatch || 0);
      return `PKR ${formatNum(costPerUnit * qty)}`;
    },
  },
];

export function FormulaDetailsContainer({ formulaId }: { formulaId: string }) {
  const { data: formula } = useSuspenseQuery({
    queryKey: ["formula", formulaId],
    queryFn: () => getFormulaByIdFn({ data: { id: formulaId } }),
  });
  const { data: viewerAccess } = useViewerAccess();
  const deactivateFormula = useDeleteFormula();
  const canManage =
    !!viewerAccess &&
    hasPermission(viewerAccess.permissions, "manufacturing.manage");

  if (!formula) return <div>Mixing Formula not found</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="md:col-span-1 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Information</CardTitle>
            {canManage && (
              <CreateFormulaDialog
                key={String(formula.updatedAt)}
                initialFormula={formula}
              />
            )}
            {canManage && formula.isActive && (
              <Button
                variant="destructive"
                disabled={deactivateFormula.isPending}
                onClick={() =>
                  deactivateFormula.mutate({ data: { id: formula.id } })
                }
              >
                Deactivate Mixing Formula
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Name</p>
              <p className="font-medium">{formula.name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Product</p>
              <p className="font-medium">{formula.product?.name}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Batch Size</p>
              <p className="font-medium">
                {formula.batchSize} {formula.batchUnit}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Status</p>
              <Badge variant={formula.isActive ? "default" : "secondary"}>
                {formula.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Est. Total Cost</p>
              <p className="font-medium">
                PKR {formatNum(Number(formula.estimatedIngredientsCost))}
              </p>
            </div>
            {formula.productionInstructions && (
              <div>
                <p className="text-sm text-muted-foreground">
                  Production instructions
                </p>
                <p className="whitespace-pre-wrap">
                  {formula.productionInstructions}
                </p>
              </div>
            )}
            {formula.notes && (
              <div>
                <p className="text-sm text-muted-foreground">Notes</p>
                <p className="whitespace-pre-wrap">{formula.notes}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="md:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Ingredients list</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={ingredientColumns}
              data={formula.ingredients || []}
              searchKey="chemical.name"
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
