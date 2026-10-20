import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function getContext() {
  return {
    // The router creates this context once per SSR request and once in the browser.
    queryClient: new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 30_000,
          gcTime: 5 * 60_000,
          retry: 2,
          refetchOnWindowFocus: false,
        },
      },
    }),
  };
}

export function Provider({
  children,
  queryClient,
}: {
  children: React.ReactNode;
  queryClient: QueryClient;
}) {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
