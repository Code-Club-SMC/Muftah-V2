import { createFileRoute } from "@tanstack/react-router";
import { ByProductsPage } from "@/components/finance/by-products-page";

export const Route = createFileRoute("/_protected/finance/by-products/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex min-h-full flex-col p-4 sm:p-8">
        <header className="border-b pb-8">
          <h1 className="text-3xl font-bold uppercase tracking-tighter">By-Products</h1>
          <p className="mt-2 text-muted-foreground">
            Empty containers from used stock, and what they were sold for.
          </p>
        </header>
        <div className="flex-1 py-8">
          <ByProductsPage />
        </div>
      </div>
    </main>
  );
}
