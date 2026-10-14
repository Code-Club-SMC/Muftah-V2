import { useId, useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { MixingLabReports } from "@/components/mixing/mixing-lab-reports";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { getProductionQCBatchesFn } from "@/server-functions/manufacturing/mixing/lab-reports-fn";

type Batch = Awaited<
  ReturnType<typeof getProductionQCBatchesFn>
>["batches"][number];

export function ProductionQCContainer() {
  const searchId = useId();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Batch | null>(null);
  const { data, isPending, isFetching, error, refetch } = useQuery({
    queryKey: ["production-qc-batches", { search, page }],
    queryFn: () =>
      getProductionQCBatchesFn({ data: { search, page, limit: 20 } }),
    staleTime: 30_000,
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(input.trim());
    setPage(1);
  }
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Select a mixing batch</CardTitle>
          <CardDescription>
            Search by batch number, formula or product to review and record
            quality checks.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={submit}>
            <FieldGroup className="flex-row items-end gap-3">
              <Field>
                <FieldLabel htmlFor={searchId}>
                  Search mixing batches
                </FieldLabel>
                <Input
                  id={searchId}
                  maxLength={200}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder="Batch, formula or product"
                />
              </Field>
              <Button type="submit" disabled={isFetching}>
                Search
              </Button>
            </FieldGroup>
          </form>
          {isPending && <Skeleton className="h-32 w-full" />}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>
                {error.message}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void refetch()}
                >
                  Retry batches
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {data?.batches.length === 0 && (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>No matching batches</EmptyTitle>
                <EmptyDescription>
                  Try another batch number, formula or product.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {data?.batches.map((batch) => (
              <Button
                key={batch.id}
                variant={selected?.id === batch.id ? "secondary" : "outline"}
                className="h-auto min-w-0 justify-start p-4 text-left"
                aria-pressed={selected?.id === batch.id}
                onClick={() => setSelected(batch)}
              >
                <span className="flex min-w-0 flex-1 flex-col gap-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{batch.batchId}</span>
                    <Badge variant="outline">
                      {batch.status.replaceAll("_", " ")}
                    </Badge>
                  </span>
                  <span className="truncate">{batch.productName}</span>
                  <span className="truncate text-sm text-muted-foreground">
                    {batch.formulaName}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {batch.actualBulkProduced ?? "0"} /{" "}
                    {batch.targetBulkQuantity} {batch.bulkUnit}
                  </span>
                </span>
              </Button>
            ))}
          </div>
          {(page > 1 || data?.hasMore) && (
            <div className="flex flex-wrap items-center justify-end gap-3">
              <Button
                variant="outline"
                disabled={page === 1 || isFetching}
                onClick={() => setPage((current) => current - 1)}
              >
                Previous batches
              </Button>
              <p className="text-sm text-muted-foreground">Page {page}</p>
              <Button
                variant="outline"
                disabled={!data?.hasMore || isFetching}
                onClick={() => setPage((current) => current + 1)}
              >
                Next batches
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
      {selected ? (
        <section
          aria-label={`Quality reports for batch ${selected.batchId}`}
          className="flex flex-col gap-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-medium">
              Batch {selected.batchId} · {selected.productName}
            </h2>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSelected(null)}
            >
              Clear selected batch
            </Button>
          </div>
          <MixingLabReports
            key={selected.id}
            mixingRunId={selected.id}
            batchId={selected.batchId}
            productName={selected.productName}
          />
        </section>
      ) : (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Choose a batch to open its quality reports</EmptyTitle>
            <EmptyDescription>
              Each report records the analysis checks, results and certification
              for the selected batch.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
