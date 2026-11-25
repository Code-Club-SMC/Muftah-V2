import { createFileRoute } from "@tanstack/react-router";
import { ReturnedStockView } from "@/components/inventory/returned-stock/returned-stock-view";

export const Route = createFileRoute("/_protected/inventory/returned-stock")({
  component: ReturnedStockPage,
});

function ReturnedStockPage() {
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex flex-col min-h-full p-8">
        <header className="border-b pb-8">
          <h1 className="font-bold text-3xl uppercase tracking-tighter">Returned Stock</h1>
          <p className="mt-2 text-muted-foreground">
            Damaged and expired packs from customer returns. Scrap them, sell them as seconds, or lower their value.
          </p>
        </header>
        <div className="flex-1 py-8">
          <ReturnedStockView />
        </div>
      </div>
    </main>
  );
}
