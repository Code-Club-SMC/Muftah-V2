import { useSuspenseQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getMixingRunsFn } from "@/server-functions/manufacturing/mixing/get-mixing-runs-fn";
import { GenericEmpty } from "@/components/custom/empty";

export const MixingOperatorInterface = () => {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("all");
  const { data } = useSuspenseQuery({
    queryKey: ["operator-mixing-runs", "list", { page, search, stage }],
    queryFn: () =>
      getMixingRunsFn({
        data: {
          statuses:
            stage === "packing"
              ? ["completed"]
              : stage === "mixing"
                ? ["in_progress", "scheduled"]
                : ["in_progress", "scheduled", "completed"],
          page,
          limit: 10,
          search,
        },
      }),
  });
  return (
    <div className="flex flex-col gap-6">
      <FieldGroup className="max-w-lg">
        <Field>
          <FieldLabel htmlFor="batch-search">Find a batch</FieldLabel>
          <Input
            id="batch-search"
            aria-label="Search assigned mixing batches"
            placeholder="Search batch ID or formula…"
            value={search}
            className="h-12"
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </Field>
      </FieldGroup>
      <ToggleGroup
        type="single"
        variant="outline"
        value={stage}
        aria-label="Batch stage"
        onValueChange={(value) => {
          if (value) {
            setStage(value);
            setPage(1);
          }
        }}
      >
        <ToggleGroupItem value="all">All batches</ToggleGroupItem>
        <ToggleGroupItem value="mixing">Mixing</ToggleGroupItem>
        <ToggleGroupItem value="packing">Packing</ToggleGroupItem>
      </ToggleGroup>
      {data.pagination.total === 0 && (
        <GenericEmpty
          title="No matching batches"
          description="Try another batch ID or change the stage filter."
        />
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.runs.map((run) => (
          <Card key={run.id}>
            <CardHeader>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <Badge variant="outline">#{run.batchId}</Badge>
                <Badge variant="secondary">
                  {run.status === "completed"
                    ? "Mixing complete"
                    : run.status === "in_progress"
                      ? "Mixing"
                      : "Scheduled"}
                </Badge>
              </div>
              <CardTitle>{run.formulaName}</CardTitle>
              <CardDescription>
                {run.status === "completed"
                  ? "Record packing or view the saved split."
                  : "Open this batch to record production."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-sm text-muted-foreground">Produced</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">
                    {Number(run.actualBulkProduced || 0).toLocaleString()}{" "}
                    {run.bulkUnit}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm text-muted-foreground">Target</dt>
                  <dd className="mt-1 text-xl font-semibold tabular-nums">
                    {Number(run.targetBulkQuantity).toLocaleString()}{" "}
                    {run.bulkUnit}
                  </dd>
                </div>
              </dl>
            </CardContent>
            <CardFooter>
              <Button
                asChild
                variant={run.status === "completed" ? "default" : "outline"}
                className="min-h-12 w-full"
              >
                <Link to="/operator/mixing/$runId" params={{ runId: run.id }}>
                  {run.status === "completed" ? "Open packing" : "Open batch"}
                </Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Page {page} of {Math.max(1, data.pagination.totalPages)} ·{" "}
          {data.pagination.total} batches
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="min-h-11"
            disabled={page <= 1}
            onClick={() => setPage((current) => current - 1)}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            className="min-h-11"
            disabled={page >= data.pagination.totalPages}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
};
