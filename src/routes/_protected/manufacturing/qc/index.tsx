import { createFileRoute } from "@tanstack/react-router";
import { ProductionQCContainer } from "@/components/production-qc/production-qc-container";

export const Route = createFileRoute("/_protected/manufacturing/qc/")({
  component: ProductionQCPage,
});

function ProductionQCPage() {
  return (
    <main className="flex-1 overflow-y-auto">
      <div className="flex min-h-full flex-col gap-8 p-4 sm:p-8">
        <header className="border-b pb-6">
          <h1 className="text-3xl font-bold uppercase tracking-tighter">
            Production QC
          </h1>
          <p className="mt-2 text-muted-foreground">
            Record and certify the quality of each mixing batch.
          </p>
        </header>
        <ProductionQCContainer />
      </div>
    </main>
  );
}
