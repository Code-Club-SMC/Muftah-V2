import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getReturnedStockFn,
  scrapReturnedStockFn,
  sellReturnedStockFn,
  setReturnedStockValueFn,
  voidReturnedStockMovementFn,
} from "@/server-functions/inventory/returned-stock-fn";
import type { ReturnedCondition } from "@/lib/inventory/returned-stock";

export const returnedStockKey = ["returned-stock"] as const;
export type ReturnedStockData = Awaited<ReturnType<typeof getReturnedStockFn>>;
export type ReturnedStockRow = ReturnedStockData["rows"][number];
export type ReturnedStockMovementRow = ReturnedStockData["movements"][number];

type StockKey = { warehouseId: string; recipeId: string; condition: ReturnedCondition };
export type ScrapInput = StockKey & { units: number; note?: string };
export type SellInput = StockKey & { units: number; unitPrice: number; walletId: string; note?: string };
export type SetValueInput = StockKey & { valuePerPack: number; note: string };
export type VoidMovementInput = { movementId: string; reason: string };

export function useReturnedStock() {
  return useQuery({ queryKey: returnedStockKey, queryFn: () => getReturnedStockFn() });
}

/** Errors stay in the dialog that sent them; success refreshes stock, accounts and reports. */
function useReturnedStockMutation<TInput>(send: (input: TInput) => Promise<unknown>, success: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: send,
    retry: false,
    onSuccess: async () => {
      toast.success(success);
      const keys = [returnedStockKey, ["wallets"], ["transactions"], ["transactions-recent"], ["daily-closing"], ["reports"]];
      await Promise.all(keys.map(queryKey => qc.invalidateQueries({ queryKey })));
    },
  });
}

export const useScrapReturnedStock = () =>
  useReturnedStockMutation((data: ScrapInput) => scrapReturnedStockFn({ data }), "Packs scrapped.");
export const useSellReturnedStock = () =>
  useReturnedStockMutation((data: SellInput) => sellReturnedStockFn({ data }), "Seconds sale recorded.");
export const useSetReturnedStockValue = () =>
  useReturnedStockMutation((data: SetValueInput) => setReturnedStockValueFn({ data }), "Value lowered.");
export const useVoidReturnedStockMovement = () =>
  useReturnedStockMutation((data: VoidMovementInput) => voidReturnedStockMovementFn({ data }), "Entry voided.");
