import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { PurchaseRecord } from "@/components/suppliers/purchase-history-table";

export type SimilarMaterial = { id: string; name: string; exact: boolean; stock: string; unit: string };

export function SimilarMaterialWarning({
  matches,
  onAddStock,
  onConfirmNew,
}: {
  matches: SimilarMaterial[];
  onAddStock: (id: string) => void;
  onConfirmNew: () => void;
}) {
  if (!matches.length) return null;
  const anyExact = matches.some((match) => match.exact);
  return (
    <Alert>
      <AlertDescription className="flex flex-col gap-3">
        {matches.map((match) => (
          <div key={match.id} className="flex flex-col gap-2">
            <p>{`Similar item already exists: "${match.name}" (${Number(match.stock)} ${match.unit} in stock)`}</p>
            <Button type="button" variant="secondary" onClick={() => onAddStock(match.id)}>
              {`Add stock to ${match.name} instead`}
            </Button>
          </div>
        ))}
        {!anyExact && (
          <Button type="button" variant="outline" onClick={onConfirmNew}>
            No, this is a new item
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export type SwitchToAddStock = {
  materialType: "chemical" | "packaging";
  materialId: string;
  name: string;
  quantity: string;
  costPerUnit: string;
  warehouseId: string;
  supplierId: string;
};

// The Add stock form only reads the item, quantity and total cost from the record it restocks.
export function restockRecord(item: SwitchToAddStock): PurchaseRecord {
  const quantity = parseFloat(item.quantity || "0") || 0;
  const unitCost = parseFloat(item.costPerUnit || "0") || 0;
  const cost = quantity > 0 && unitCost > 0 ? (quantity * unitCost).toFixed(2) : "";
  return {
    id: `switch-${item.materialId}`,
    createdAt: new Date(),
    cost,
    paidAmount: "0",
    quantity: item.quantity,
    unitCost: item.costPerUnit,
    materialType: item.materialType,
    chemical: item.materialType === "chemical" ? { id: item.materialId, name: item.name, unit: "", minimumStockLevel: null } : null,
    packagingMaterial:
      item.materialType === "packaging"
        ? { id: item.materialId, name: item.name, type: "", capacity: null, capacityUnit: null, minimumStockLevel: null }
        : null,
  };
}
