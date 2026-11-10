import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  OfflineDeskBackup,
  OfflineDeskEntry,
  OfflineDeskPack,
} from "@/lib/sales/offline/desk-pack";
import { OFFLINE_DESK_BACKUP_FORMAT } from "@/lib/sales/offline/desk-pack";
import {
  deleteEntry,
  isStoragePersistent,
  loadEntries,
  loadPack,
  putEntries,
  putEntry,
  requestPersistentStorage,
  savePack,
} from "@/lib/sales/offline/desk-store";
import {
  readShellStatus,
  saveOfflineShell,
  type ShellStatus,
} from "@/lib/sales/offline/desk-shell";
import {
  calculateOfflineEntry,
  type OfflineEntry,
  type OfflineEntryIssue,
} from "@/lib/sales/offline/entry-calculator";
import { outageWindow } from "@/lib/sales/offline/desk-time";
import { DESK_CHANNEL, PACK_UPDATED, waitingCount } from "@/lib/sales/offline/desk-refresh";
import { offlineBackupSchema } from "@/lib/sales/offline/entry-schema";
import { getOfflineSalesPackFn, sendOfflineSalesEntriesFn } from "@/server-functions/sales/offline-entries-fn";

export type OfflineEntryDraft = Omit<OfflineEntry, "slotNumber" | "recordToken" | "cancelled">;

export type SaveEntryResult =
  | { ok: true; entry: OfflineDeskEntry }
  | { ok: false; issues: OfflineEntryIssue[]; message?: string };

export type SendMeta = {
  outageStartedAt: string;
  outageEndedAt: string;
  outageReason: string;
};

function toEntry(desk: OfflineDeskEntry): OfflineEntry {
  return {
    slotNumber: desk.slotNumber,
    recordToken: desk.recordToken,
    saleDate: desk.saleDate,
    saleTime: desk.saleTime,
    saleType: desk.saleType,
    distributorCode: desk.distributorCode,
    orderBookerCode: desk.orderBookerCode,
    billNumber: desk.billNumber,
    paymentDueDate: desk.paymentDueDate,
    remarks: desk.remarks,
    newCustomer: desk.newCustomer ?? null,
    invoiceDiscount: desk.invoiceDiscount,
    invoiceDiscountDescription: desk.invoiceDiscountDescription ?? null,
    expenses: desk.expenses,
    expensesDescription: desk.expensesDescription ?? null,
    items: desk.items,
    payments: desk.payments,
    cancelled: desk.cancelled ?? null,
    printedTotal: desk.printedTotal,
  };
}

function customerNameOf(draft: OfflineEntryDraft, pack: OfflineDeskPack) {
  if (draft.saleType === "direct_distributor") {
    return pack.reference.distributors.find((value) => value.code === draft.distributorCode)?.name ?? "";
  }
  if (draft.saleType === "direct_retailer") {
    return (
      draft.newCustomer?.name.trim() ??
      pack.reference.retailers.find((value) => value.code === draft.distributorCode)?.name ??
      ""
    );
  }
  return (
    pack.reference.orders.find(
      (value) => value.orderBookerCode === draft.orderBookerCode && value.billNumber === draft.billNumber,
    )?.shopkeeperName ?? ""
  );
}

function message(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * The browser's own "online" flag is true whenever the router works, even if
 * the internet is dead. So ask the server itself.
 */
async function serverReachable() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4000);
  try {
    const response = await fetch("/api/health", { cache: "no-store", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function useOfflineDesk() {
  const [pack, setPack] = useState<OfflineDeskPack | null>(null);
  const [entries, setEntries] = useState<OfflineDeskEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [reachable, setReachable] = useState(false);
  // When the internet came back after an outage this page saw. Null if we did not see one.
  const [restoredAt, setRestoredAt] = useState<Date | null>(null);
  // Testing aid on the dev server: act as if the internet were down.
  const [pretendOffline, setPretendOffline] = useState(false);
  const online = reachable && !pretendOffline;
  const [persisted, setPersisted] = useState(false);
  const [shell, setShell] = useState<ShellStatus>({ ready: false, files: 0 });
  const [storageError, setStorageError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [nextPack, nextEntries, nextPersisted, nextShell] = await Promise.all([
        loadPack(),
        loadEntries(),
        isStoragePersistent(),
        readShellStatus(),
      ]);
      setPack(nextPack);
      setEntries(nextEntries);
      setPersisted(nextPersisted);
      setShell(nextShell);
      setStorageError(null);
    } catch (error) {
      setStorageError(message(error, "Could not read offline storage."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Keeps asking the server whether the internet is really there.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let current = false; // what the screen says right now
    let known = false; // has the first check finished?
    let goodChecks = 0;

    const apply = (next: boolean) => {
      if (known && next === current) return;
      // An outage that ends is the moment the office is waiting to hear about.
      if (next && known && !current) setRestoredAt(new Date());
      if (!next) setRestoredAt(null);
      current = next;
      known = true;
      setReachable(next);
    };

    const check = async () => {
      clearTimeout(timer);
      const up = navigator.onLine && (await serverReachable());
      if (stopped) return;
      if (up) {
        goodChecks += 1;
        // Coming back is trusted only after two good checks in a row, so a flicker changes nothing.
        if (!known || current || goodChecks >= 2) apply(true);
      } else {
        goodChecks = 0;
        apply(false);
      }
      timer = setTimeout(() => void check(), current ? 15_000 : goodChecks > 0 ? 2_000 : 5_000);
    };

    const onOnline = () => void check();
    const onOffline = () => {
      goodChecks = 0;
      apply(false);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    void check();
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const pretendInternetDown = useCallback((down: boolean) => {
    setPretendOffline(down);
    setRestoredAt(down ? null : new Date());
  }, []);

  const workbookEntries = useMemo(
    () => entries.filter((entry) => entry.workbookId === pack?.workbookId),
    [entries, pack?.workbookId],
  );
  const freeSlots = useMemo(() => {
    if (!pack) return [];
    const used = new Set(workbookEntries.map((entry) => entry.slotNumber));
    return pack.slots.filter((slot) => !used.has(slot.slotNumber));
  }, [pack, workbookEntries]);
  const unsent = useMemo(
    () => workbookEntries.filter((entry) => entry.status !== "sent"),
    [workbookEntries],
  );

  // Prices only change while nothing printed is waiting to be sent, so a
  // printed invoice always matches what the office will book.
  const hasUnsentAnywhere = entries.some((entry) => entry.status !== "sent");
  // The background refresher runs in whichever Titan tab is open. It saves a
  // newer price list in browser storage and announces it here; reload when it does.
  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(DESK_CHANNEL);
    channel.onmessage = (event) => {
      if (event.data === PACK_UPDATED) void refresh();
    };
    return () => channel.close();
  }, [refresh]);

  /** Downloads the price list and reserved numbers, and saves the offline page. Needs internet. */
  const prepare = useCallback(async () => {
    const fresh = await getOfflineSalesPackFn({ data: { hasUnsentInvoices: hasUnsentAnywhere } });
    const stranded = entries.filter(
      (entry) => entry.workbookId !== fresh.workbookId && entry.status !== "sent",
    );
    if (stranded.length > 0) {
      throw new Error(
        `${stranded.length} invoice(s) from the previous set of invoice numbers are not sent yet. Send them first.`,
      );
    }
    await savePack(fresh);
    await requestPersistentStorage();
    const saved = await saveOfflineShell();
    await refresh();
    return saved;
  }, [entries, hasUnsentAnywhere, refresh]);

  const saveEntry = useCallback(
    async (draft: OfflineEntryDraft, editSlot?: number): Promise<SaveEntryResult> => {
      if (!pack) return { ok: false, issues: [], message: "Prepare this computer first." };
      const existing = editSlot ? workbookEntries.find((entry) => entry.slotNumber === editSlot) : undefined;
      if (existing && existing.status !== "saved") {
        return { ok: false, issues: [], message: "A printed invoice cannot be changed." };
      }
      const slot = existing
        ? { slotNumber: existing.slotNumber, reservedSerial: existing.reservedSerial, recordToken: existing.recordToken }
        : freeSlots[0];
      if (!slot) return { ok: false, issues: [], message: "No invoice numbers left in this workbook." };
      const entry: OfflineEntry = { ...draft, slotNumber: slot.slotNumber, recordToken: slot.recordToken };
      const calculated = calculateOfflineEntry(entry, pack.reference, slot.reservedSerial);
      if (calculated.issues.length > 0) return { ok: false, issues: calculated.issues };
      const desk: OfflineDeskEntry = {
        ...entry,
        printedTotal: calculated.invoiceAmount,
        workbookId: pack.workbookId,
        reservedSerial: slot.reservedSerial,
        invoiceNumber: calculated.invoiceNumber,
        invoiceAmount: calculated.invoiceAmount,
        customerName: customerNameOf(draft, pack),
        status: "saved",
        savedAt: new Date().toISOString(),
        printedAt: null,
        sentAt: null,
        sentBatchId: null,
      };
      try {
        await putEntry(desk);
      } catch (error) {
        return { ok: false, issues: [], message: message(error, "Could not save in this browser.") };
      }
      await refresh();
      return { ok: true, entry: desk };
    },
    [freeSlots, pack, refresh, workbookEntries],
  );

  // Takes the entry itself, not a slot number: the caller often prints right
  // after saving, before this hook has re-rendered with the new list.
  const markPrinted = useCallback(
    async (entry: OfflineDeskEntry) => {
      if (entry.status !== "saved") return;
      await putEntry({ ...entry, status: "printed", printedAt: new Date().toISOString() });
      await refresh();
    },
    [refresh],
  );

  /** A printed invoice cannot be deleted; it is cancelled and keeps its number. */
  const cancelEntry = useCallback(
    async (entry: OfflineDeskEntry, reason: string) => {
      const cleaned = reason.trim();
      if (cleaned.length < 3) throw new Error("Give a reason for cancelling (at least 3 characters).");
      if (entry.status !== "printed") {
        throw new Error(
          entry.status === "sent"
            ? "This invoice was already sent. Void it from Sales > Invoices instead."
            : "Only a printed invoice can be cancelled.",
        );
      }
      await putEntry({
        ...entry,
        status: "cancelled",
        cancelled: { reason: cleaned, at: new Date().toISOString() },
      });
      await refresh();
    },
    [refresh],
  );

  const removeEntry = useCallback(
    async (slotNumber: number) => {
      const entry = workbookEntries.find((value) => value.slotNumber === slotNumber);
      if (!entry || entry.status !== "saved") {
        throw new Error("Only an invoice that was never printed can be deleted.");
      }
      await deleteEntry(entry.workbookId, entry.slotNumber);
      await refresh();
    },
    [refresh, workbookEntries],
  );

  const buildBackup = useCallback((): { blob: Blob; filename: string; count: number } | null => {
    if (!pack || unsent.length === 0) return null;
    const backup: OfflineDeskBackup = {
      format: OFFLINE_DESK_BACKUP_FORMAT,
      version: 1,
      workbookId: pack.workbookId,
      exportedAt: new Date().toISOString(),
      entries: unsent.map(toEntry),
    };
    const stamp = backup.exportedAt.slice(0, 16).replace(/[:T]/g, "-");
    return {
      blob: new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" }),
      filename: `offline-invoices-${stamp}-${unsent.length}-invoices.json`,
      count: unsent.length,
    };
  }, [pack, unsent]);

  const restoreBackup = useCallback(
    async (file: File) => {
      if (!pack) throw new Error("Prepare this computer first.");
      let raw: unknown;
      try {
        raw = JSON.parse(await file.text());
      } catch {
        throw new Error("That file is not a backup from the offline desk.");
      }
      const parsed = offlineBackupSchema.safeParse(raw);
      if (!parsed.success) throw new Error("That file is not a backup from the offline desk.");
      if (parsed.data.workbookId !== pack.workbookId) {
        throw new Error("That backup belongs to a different workbook.");
      }
      const have = new Set(workbookEntries.map((entry) => entry.slotNumber));
      const slots = new Map(pack.slots.map((slot) => [slot.slotNumber, slot]));
      const restored: OfflineDeskEntry[] = [];
      let skipped = 0;
      for (const entry of parsed.data.entries) {
        const slot = slots.get(entry.slotNumber);
        if (have.has(entry.slotNumber) || !slot || slot.recordToken !== entry.recordToken) {
          skipped += 1;
          continue;
        }
        const calculated = calculateOfflineEntry(entry, pack.reference, slot.reservedSerial);
        if (calculated.issues.length > 0) {
          skipped += 1;
          continue;
        }
        const now = new Date().toISOString();
        restored.push({
          ...entry,
          workbookId: pack.workbookId,
          reservedSerial: slot.reservedSerial,
          invoiceNumber: calculated.invoiceNumber,
          invoiceAmount: calculated.invoiceAmount,
          customerName: customerNameOf(entry, pack),
          // A restored invoice may already have been handed to a customer, so lock it.
          status: entry.cancelled ? "cancelled" : "printed",
          savedAt: now,
          printedAt: now,
          sentAt: null,
          sentBatchId: null,
        });
      }
      await putEntries(restored);
      await refresh();
      return { restored: restored.length, skipped };
    },
    [pack, refresh, workbookEntries],
  );

  const send = useCallback(
    async (meta: SendMeta) => {
      if (!pack) throw new Error("Prepare this computer first.");
      if (unsent.length === 0) throw new Error("There are no invoices to send.");
      const result = await sendOfflineSalesEntriesFn({
        data: {
          workbookId: pack.workbookId,
          outageStartedAt: meta.outageStartedAt,
          outageEndedAt: meta.outageEndedAt,
          outageReason: meta.outageReason,
          source: "desk",
          entries: unsent.map(toEntry),
        },
      });
      const sentAt = new Date().toISOString();
      await putEntries(unsent.map((entry) => ({ ...entry, status: "sent", sentAt, sentBatchId: result.batchId })));
      await refresh();
      return result;
    },
    [pack, refresh, unsent],
  );

  /** One-tap send: the outage window is worked out, only the reason is chosen. */
  const sendNow = useCallback(
    async (reason: string) => {
      const { started, ended } = outageWindow(unsent, restoredAt);
      return send({
        outageStartedAt: started.toISOString(),
        outageEndedAt: ended.toISOString(),
        outageReason: reason.trim(),
      });
    },
    [restoredAt, send, unsent],
  );

  return {
    loading,
    online,
    restoredAt,
    pretendOffline,
    pretendInternetDown,
    persisted,
    shell,
    storageError,
    pack,
    entries: workbookEntries,
    freeSlots,
    unsent,
    /** Invoices on this computer (any workbook) that the office does not have yet. */
    waiting: waitingCount(entries),
    prepare,
    saveEntry,
    markPrinted,
    cancelEntry,
    removeEntry,
    buildBackup,
    restoreBackup,
    send,
    sendNow,
    refresh,
  };
}

export type OfflineDesk = ReturnType<typeof useOfflineDesk>;
