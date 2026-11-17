import { createFileRoute } from "@tanstack/react-router";
import { OtherIncomePage } from "@/components/finance/other-income-page";

export const Route = createFileRoute("/_protected/finance/other-income/")({
  component: RouteComponent,
});

function RouteComponent() {
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex min-h-full flex-col p-4 sm:p-8">
        <header className="border-b pb-8">
          <h1 className="text-3xl font-bold uppercase tracking-tighter">Other Income</h1>
          <p className="mt-2 text-muted-foreground">
            Money received that is not a sale, like empty drums or cartons sold.
          </p>
        </header>
        <div className="flex-1 py-8">
          <OtherIncomePage />
        </div>
      </div>
    </main>
  );
}
