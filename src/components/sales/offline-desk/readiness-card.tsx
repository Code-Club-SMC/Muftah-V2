import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import type { OfflineDesk } from "@/hooks/sales/use-offline-desk";
import { useFreshness } from "./freshness-label";

function Check({ ok, label, hint }: { ok: boolean; label: string; hint?: string }) {
  return (
    <li className="flex items-start gap-3">
      <span
        className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
          ok ? "bg-emerald-500/20 text-emerald-500" : "bg-amber-500/20 text-amber-500"
        }`}
        aria-hidden
      >
        {ok ? "✓" : "!"}
      </span>
      <div>
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
    </li>
  );
}

export function ReadinessCard({ desk }: { desk: OfflineDesk }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pack = desk.pack;
  const ready = Boolean(pack) && desk.shell.ready;
  const freshness = useFreshness(desk);
  const freshnessHint =
    freshness?.tone === "stale"
      ? "Not updating. The page keeps trying every 5 minutes while Titan is open."
      : freshness?.tone === "paused"
        ? "Send them from the Send & backup tab and updates carry on by themselves."
        : undefined;

  const prepare = async () => {
    setBusy(true);
    setError(null);
    try {
      await desk.prepare();
      toast.success("This computer is ready to work without internet.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not prepare this computer.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ready ? "Ready for an outage" : "Prepare this computer"}</CardTitle>
        <CardDescription>
          {ready
            ? "You can keep working if the internet stops. Open this same page and carry on."
            : "Do this once while the internet works. It saves the price list, invoice numbers and this page on this computer."}
        </CardDescription>
        <CardAction>
          <Badge variant={desk.online ? "secondary" : "outline"}>{desk.online ? "Online" : "Offline"}</Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-3">
          <Check
            ok={Boolean(pack)}
            label={pack ? `Price list and invoice numbers saved · ${desk.freeSlots.length} numbers left` : "Price list and invoice numbers not saved yet"}
            hint={pack ? `Numbers issued ${new Date(pack.issuedAt).toLocaleString("en-PK", { timeZone: "Asia/Karachi" })} for ${pack.operatorName}` : undefined}
          />
          {freshness && (
            <Check
              ok={freshness.tone === "ok" || freshness.tone === "offline"}
              label={freshness.text}
              hint={freshnessHint}
            />
          )}
          <Check
            ok={desk.shell.ready}
            label={desk.shell.ready ? "This page works without internet" : "This page is not saved for offline use yet"}
            hint={desk.shell.ready ? `${desk.shell.files} files saved` : "Press the button below while online."}
          />
          <Check
            ok={desk.persisted}
            label={desk.persisted ? "Browser will not delete your invoices" : "Browser may delete invoices if the disk gets full"}
            hint={desk.persisted ? undefined : "Download a backup regularly (Send & backup tab), and print every invoice."}
          />
        </ul>
        {desk.storageError && <p className="text-sm text-destructive">{desk.storageError}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div>
          <Button onClick={() => void prepare()} disabled={busy || !desk.online} variant={ready ? "outline" : "default"}>
            {busy && <Spinner data-icon="inline-start" />}
            {busy ? "Preparing…" : ready ? "Refresh this computer" : "Prepare this computer"}
          </Button>
          {!desk.online && <p className="mt-2 text-xs text-muted-foreground">Needs internet.</p>}
        </div>
      </CardContent>
    </Card>
  );
}
