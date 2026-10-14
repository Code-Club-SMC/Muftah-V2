import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GenericEmpty } from "@/components/custom/empty";
import type { getFactoryFloorStockFn } from "@/server-functions/inventory/factory-floor/get-factory-floor-stocks-fn";

type MixedBulkBatch = NonNullable<
  Awaited<ReturnType<typeof getFactoryFloorStockFn>>
>["mixedBulk"][number];

export function MixedBulkTable({
  data,
  canOpenBatch,
}: {
  data: MixedBulkBatch[];
  canOpenBatch: boolean;
}) {
  if (data.length === 0) {
    return (
      <GenericEmpty
        title="No Mixed Bulk Awaiting Packing"
        description="Completed mixing batches with bulk available or packing jobs underway will appear here."
      />
    );
  }

  return (
    <div className="border border-border">
      <Table aria-label="Mixed bulk awaiting packing">
        <TableCaption>
          Reserved includes bulk committed to existing packing jobs. Cancelled
          jobs release their reservation.
        </TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Batch ID</TableHead>
            <TableHead scope="col">Mixing Formula</TableHead>
            <TableHead scope="col" className="text-right">
              Produced
            </TableHead>
            <TableHead scope="col" className="text-right">
              Reserved for Packing
            </TableHead>
            <TableHead scope="col" className="text-right">
              Available to Pack
            </TableHead>
            {canOpenBatch && (
              <TableHead scope="col" className="text-right">
                Actions
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((batch) => (
            <TableRow key={batch.id}>
              <TableCell>{batch.batchId}</TableCell>
              <TableCell>{batch.formulaName}</TableCell>
              <TableCell className="text-right tabular-nums">
                {batch.producedQuantity} {batch.bulkUnit}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {batch.reservedQuantity} {batch.bulkUnit}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {batch.availableQuantity} {batch.bulkUnit}
              </TableCell>
              {canOpenBatch && (
                <TableCell className="text-right">
                  <Button asChild variant="outline" size="sm">
                    <Link
                      to="/manufacturing/mixing/$runId"
                      params={{ runId: batch.id }}
                      aria-label={`Open Batch ${batch.batchId}`}
                    >
                      Open Batch
                    </Link>
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
