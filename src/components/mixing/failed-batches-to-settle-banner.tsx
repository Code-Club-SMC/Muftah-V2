import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useFailedBatchesToSettle } from "@/hooks/manufacturing/mixing/use-failed-batch-settlement";

/**
 * Reminder for failed batches whose chemicals were never returned to stock
 * or written off. Without it, those chemicals stay counted as used forever.
 */
export function FailedBatchesToSettleBanner({ linkTo }: { linkTo: "manager" | "operator" }) {
  const { data } = useFailedBatchesToSettle();
  if (!data || data.total === 0) return null;

  return (
    <Alert variant="destructive" aria-label="Failed batches with chemicals to settle">
      <AlertTitle>
        {data.total} failed batch{data.total === 1 ? "" : "es"} still {data.total === 1 ? "has" : "have"} chemicals to settle
      </AlertTitle>
      <AlertDescription>
        <p>These chemicals left stock when the batch started. Open each batch and enter how much came back.</p>
        <ul className="mt-2 flex flex-col gap-1">
          {data.batches.map((batch) => (
            <li key={batch.mixingRunId} className="flex flex-wrap items-center gap-x-2">
              {linkTo === "manager" ? (
                <Link to="/manufacturing/mixing/$runId" params={{ runId: batch.mixingRunId }} className="font-medium underline underline-offset-2">
                  {batch.batchId}
                </Link>
              ) : (
                <Link to="/operator/mixing/$runId" params={{ runId: batch.mixingRunId }} className="font-medium underline underline-offset-2">
                  {batch.batchId}
                </Link>
              )}
              <span>
                {batch.pendingChemicals} chemical{batch.pendingChemicals === 1 ? "" : "s"} on {batch.factoryFloor}
                {batch.failedAt ? `, failed ${formatDistanceToNow(new Date(batch.failedAt), { addSuffix: true })}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  );
}
