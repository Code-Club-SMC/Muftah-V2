import { useQuery } from "@tanstack/react-query";
import { getViewerAccessFn } from "@/server-functions/auth/get-viewer-access-fn";

export const viewerAccessQueryKey = ["viewer-access"];

export function useViewerAccess() {
  return useQuery({
    queryKey: viewerAccessQueryKey,
    queryFn: () => getViewerAccessFn(),
    staleTime: 30_000,
  });
}
