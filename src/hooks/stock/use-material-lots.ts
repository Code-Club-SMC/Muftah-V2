import { useQuery } from "@tanstack/react-query";
import { getMaterialLotsFn } from "@/server-functions/inventory/stock/get-material-lots-fn";
import type { MaterialType } from "@/lib/inventory/material-lots";

export function useMaterialLots(warehouseId: string | undefined, materialType: MaterialType, materialIds: string[]) {
  const ids = [...new Set(materialIds.filter(Boolean))].sort();
  return useQuery({
    queryKey: ["material-lots", warehouseId, materialType, ids],
    queryFn: () => getMaterialLotsFn({ data: { warehouseId: warehouseId!, materialType, materialIds: ids } }),
    enabled: !!warehouseId && ids.length > 0,
  });
}
