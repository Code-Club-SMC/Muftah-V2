import { useQuery } from "@tanstack/react-query";
import { getProductDetailFn } from "@/server-functions/inventory/products/get-product-detail-fn";

export function useProductDetail(productId: string) {
  return useQuery({
    queryKey: ["product-detail", productId],
    queryFn: () => getProductDetailFn({ data: { id: productId } }),
    enabled: !!productId,
  });
}
