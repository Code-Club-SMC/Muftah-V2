import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useOfflineDesk } from "@/hooks/sales/use-offline-desk";
import type { OfflineDeskEntry } from "@/lib/sales/offline/desk-pack";
import { removeOfflineShell } from "@/lib/sales/offline/desk-shell";
import { clearDesk } from "@/lib/sales/offline/desk-store";
import { EntryForm } from "./entry-form";
import { FreshnessBadge } from "./freshness-label";
import { InternetBackBanner } from "./internet-back-banner";
import { InvoicePreview } from "./invoice-preview";
import { ReadinessCard } from "./readiness-card";
import { SavedInvoices } from "./saved-invoices";
import { SendPanel } from "./send-panel";

const LOW_NUMBERS = 50;

// Dev server only: act as if the internet were down, so the whole outage and
// "internet is back" flow can be tried without stopping the server.
function DevPretendButton({ desk }: { desk: ReturnType<typeof useOfflineDesk> }) {
  return (
    <Button
      variant={desk.pretendOffline ? "default" : "outline"}
      size="sm"
      onClick={() => desk.pretendInternetDown(!desk.pretendOffline)}
    >
      {desk.pretendOffline ? "Dev: internet is pretend-down (click: bring it back)" : "Dev: pretend internet is down"}
    </Button>
  );
}

// Dev server only: one click instead of clearing the service worker, the
// browser database and the cache by hand before each test run.
function DevWipeButton() {
  const wipe = async () => {
    if (!window.confirm("Dev only: erase every offline invoice, the saved price list and the offline page on this browser?")) {
      return;
    }
    await clearDesk();
    await removeOfflineShell();
    window.location.reload();
  };
  return (
    <Button variant="outline" size="sm" onClick={() => void wipe()}>
      Dev: wipe this browser
    </Button>
  );
}

export function OfflineDeskPage() {
  const desk = useOfflineDesk();
  const [tab, setTab] = useState("new");
  const [editing, setEditing] = useState<OfflineDeskEntry | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [printing, setPrinting] = useState<{ entry: OfflineDeskEntry; reprint: boolean } | null>(null);

  // Opening the print view locks the invoice: once a copy may have left the
  // building it can only be cancelled, never changed.
  const print = async (entry: OfflineDeskEntry) => {
    setPrinting({ entry, reprint: Boolean(entry.printedAt) });
    await desk.markPrinted(entry);
  };

  if (desk.loading) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-4 p-6">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const ready = Boolean(desk.pack);
  const unsentCount = desk.unsent.length;
  // Once the internet is really back, invoices waiting to be sent must go out
  // before anything new is made on this desk.
  const locked = desk.online && unsentCount > 0;
  const shownTab = locked && tab === "new" ? "saved" : tab;

  return (
    <>
      <main className="mx-auto flex min-h-screen max-w-5xl flex-col gap-6 p-6">
        <InternetBackBanner desk={desk} />
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">Offline invoice desk</h1>
            <Badge variant={desk.online ? "secondary" : "default"}>
              {desk.online ? "Internet connected" : "Working offline"}
            </Badge>
            {ready && <Badge variant="outline">{desk.freeSlots.length} invoice numbers left</Badge>}
            {ready && <FreshnessBadge desk={desk} />}
            {import.meta.env.DEV && (
              <>
                <DevPretendButton desk={desk} />
                <DevWipeButton />
              </>
            )}
          </div>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Make and print invoices when the internet is down. Everything is saved on this computer, then sent to the
            office when the internet returns.
          </p>
        </header>

        {desk.pack && desk.freeSlots.length <= LOW_NUMBERS && (
          <Alert variant="destructive">
            <AlertTitle>Only {desk.freeSlots.length} invoice numbers left</AlertTitle>
            <AlertDescription>Send what you have. When all numbers are used and the office has reviewed them, press “Refresh this computer” for a new set.</AlertDescription>
          </Alert>
        )}
        <ReadinessCard desk={desk} />

        {ready && (
          <Tabs value={shownTab} onValueChange={setTab}>
            <TabsList className="h-auto flex-wrap justify-start">
              <TabsTrigger value="new" disabled={locked}>
                {editing ? "Change invoice" : "New invoice"}
              </TabsTrigger>
              <TabsTrigger value="saved">Saved invoices ({desk.entries.length})</TabsTrigger>
              <TabsTrigger value="send">Send &amp; backup{unsentCount ? ` (${unsentCount})` : ""}</TabsTrigger>
            </TabsList>
            <TabsContent value="new" className="mt-5">
              <EntryForm
                key={`${formKey}-${editing?.slotNumber ?? "new"}`}
                desk={desk}
                editing={editing}
                onCancelEdit={() => {
                  setEditing(null);
                  setTab("saved");
                }}
                onSaved={(entry, shouldPrint) => {
                  setEditing(null);
                  setFormKey((value) => value + 1);
                  toast.success(`Saved ${entry.invoiceNumber}`);
                  if (shouldPrint) void print(entry);
                }}
              />
            </TabsContent>
            <TabsContent value="saved" className="mt-5">
              <SavedInvoices
                entries={desk.entries}
                onPrint={(entry) => void print(entry)}
                onEdit={(entry) => {
                  if (locked) {
                    toast.info("The internet is back. Send the waiting invoices first.");
                    return;
                  }
                  setEditing(entry);
                  setTab("new");
                }}
                onCancel={(entry) => {
                  const reason = window.prompt(
                    `Why is ${entry.invoiceNumber} being cancelled? It keeps its number and is shown as cancelled.`,
                  );
                  if (reason === null) return;
                  desk.cancelEntry(entry, reason).then(
                    () => toast.success(`Cancelled ${entry.invoiceNumber}`),
                    (error: unknown) => toast.error(error instanceof Error ? error.message : "Could not cancel."),
                  );
                }}
                onDelete={(entry) => {
                  if (!window.confirm(`Delete ${entry.invoiceNumber}? Its number will be used for the next invoice.`)) return;
                  desk.removeEntry(entry.slotNumber).then(
                    () => toast.success(`Deleted ${entry.invoiceNumber}`),
                    (error: unknown) => toast.error(error instanceof Error ? error.message : "Could not delete."),
                  );
                }}
              />
            </TabsContent>
            <TabsContent value="send" className="mt-5">
              <SendPanel desk={desk} />
            </TabsContent>
          </Tabs>
        )}
      </main>

      {desk.pack && (
        <InvoicePreview
          entry={printing?.entry ?? null}
          pack={desk.pack}
          allEntries={desk.entries}
          reprint={printing?.reprint ?? false}
          onClose={() => setPrinting(null)}
        />
      )}
    </>
  );
}
