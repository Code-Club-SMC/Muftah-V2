import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { OfflineDesk } from "@/hooks/sales/use-offline-desk";
import type { OfflineSalesUploadResult } from "@/lib/sales/offline/contracts";
import { formatPKR } from "@/lib/currency-format";

const REASONS = ["Internet line was down", "Power cut", "Website or server was down"] as const;
const OTHER = "Other reason";

function errorText(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Something went wrong.";
}

function SentResult({ result, onClose }: { result: OfflineSalesUploadResult; onClose: () => void }) {
  const problems = result.counts.invalid + result.counts.needsReview;
  const rejected = result.status === "rejected";
  const headline = rejected
    ? "The office could not accept these invoices"
    : problems > 0
      ? `${problems} invoice${problems === 1 ? "" : "s"} need fixing`
      : result.counts.warning > 0
        ? `${result.counts.warning} invoice${result.counts.warning === 1 ? "" : "s"} need a quick check`
        : "All invoices are ready to post";

  return (
    <section role="status" className="flex flex-col gap-4 border-4 border-emerald-500 bg-card p-6">
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold uppercase tracking-wide text-emerald-500">Sent to the office</p>
        <h2 className="text-3xl font-black tracking-tight">{headline}</h2>
        {!rejected && (
          <p className="text-muted-foreground">
            Ready {result.counts.ready} · Warnings {result.counts.warning} · Problems {problems} · Already received{" "}
            {result.counts.duplicate}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild size="lg">
          <a href={rejected ? "/sales/offline" : `/sales/offline?batch=${result.batchId}`}>Review and post</a>
        </Button>
        <Button asChild size="lg" variant="outline">
          <a href="/sales/new-invoice">Go to online invoicing</a>
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Dismiss
        </Button>
      </div>
    </section>
  );
}

/**
 * The loud screen for the moment the internet returns: it cannot be missed, it
 * sends everything in one tap, then points to reviewing and to online invoicing.
 */
export function InternetBackBanner({ desk }: { desk: OfflineDesk }) {
  const [choice, setChoice] = useState<string>(REASONS[0]);
  const [other, setOther] = useState("");
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<OfflineSalesUploadResult | null>(null);

  const waiting = desk.unsent.length;
  const total = useMemo(() => desk.unsent.reduce((sum, entry) => sum + entry.invoiceAmount, 0), [desk.unsent]);
  const showWaiting = desk.online && waiting > 0;
  const reason = choice === OTHER ? other : choice;
  const canSend = reason.trim().length >= 5 && !sending;

  useEffect(() => {
    if (!showWaiting) return;
    const original = document.title;
    document.title = "INTERNET IS BACK — send your invoices";
    return () => {
      document.title = original;
    };
  }, [showWaiting]);

  const send = async () => {
    setSending(true);
    setProblem(null);
    try {
      setResult(await desk.sendNow(reason));
    } catch (error) {
      setProblem(errorText(error));
    } finally {
      setSending(false);
    }
  };

  if (result) return <SentResult result={result} onClose={() => setResult(null)} />;
  if (!showWaiting) return null;

  return (
    <section
      role="alert"
      className="sticky top-0 z-40 flex flex-col gap-5 border-4 border-emerald-300 bg-emerald-600 p-6 text-white shadow-2xl"
    >
      <div className="flex items-center gap-4">
        <span className="relative flex size-7 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
          <span className="relative inline-flex size-7 rounded-full bg-white" />
        </span>
        <div>
          <h2 className="text-4xl font-black tracking-tight">INTERNET IS BACK</h2>
          <p className="text-lg">
            {waiting} invoice{waiting === 1 ? "" : "s"} worth {formatPKR(total, false)} {waiting === 1 ? "is" : "are"}{" "}
            waiting. Send {waiting === 1 ? "it" : "them"} to the office now. New offline invoices are paused until then.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex min-w-64 flex-col gap-1.5">
          <label className="text-sm font-medium" htmlFor="internet-back-reason">
            Why was the internet down?
          </label>
          <Select value={choice} onValueChange={setChoice}>
            <SelectTrigger id="internet-back-reason" className="w-full bg-white text-black">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {[...REASONS, OTHER].map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {choice === OTHER && (
          <Input
            aria-label="Other reason"
            className="w-72 bg-white text-black"
            placeholder="Write the reason"
            value={other}
            onChange={(event) => setOther(event.target.value)}
          />
        )}
        <Button
          size="lg"
          className="h-12 bg-white px-8 text-lg font-bold text-emerald-700 hover:bg-white/90"
          disabled={!canSend}
          onClick={() => void send()}
        >
          {sending && <Spinner data-icon="inline-start" />}
          {sending ? "Sending…" : `Send and save ${waiting} invoice${waiting === 1 ? "" : "s"} to Database`}
        </Button>
      </div>

      {problem && (
        <p className="bg-white p-3 text-sm font-medium text-red-700">
          Could not send: {problem} If it says you are signed out,{" "}
          <a className="underline" href="/login?redirect=/offline-desk">
            sign in
          </a>{" "}
          and come back. Nothing was lost.
        </p>
      )}
    </section>
  );
}
