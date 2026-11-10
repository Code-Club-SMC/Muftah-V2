import type { OfflineDeskEntry, OfflineDeskPack } from "./desk-pack";

/**
 * Browser-side storage for the offline desk (IndexedDB, no dependencies).
 * Every write waits for the transaction to finish, so "saved" on screen means
 * the browser has really stored it.
 */

const DB_NAME = "titan-offline-desk";
const DB_VERSION = 1;
const PACK_STORE = "pack";
const ENTRY_STORE = "entries";
const PACK_KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("This browser cannot store offline invoices. Use Chrome or Edge."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PACK_STORE)) db.createObjectStore(PACK_STORE);
      if (!db.objectStoreNames.contains(ENTRY_STORE)) {
        db.createObjectStore(ENTRY_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open offline storage."));
  });
}

async function run<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (objectStore: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const db = await open();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const transaction = db.transaction(store, mode, { durability: "strict" });
      const request = work(transaction.objectStore(store));
      transaction.oncomplete = () => resolve(request ? request.result : undefined);
      transaction.onerror = () => reject(transaction.error ?? new Error("Offline storage write failed."));
      transaction.onabort = () => reject(transaction.error ?? new Error("Offline storage write was cancelled."));
    });
  } finally {
    db.close();
  }
}

type StoredEntry = OfflineDeskEntry & { key: string };

const entryKey = (workbookId: string, slotNumber: number) => `${workbookId}|${slotNumber}`;

export async function loadPack(): Promise<OfflineDeskPack | null> {
  return ((await run<OfflineDeskPack | undefined>(PACK_STORE, "readonly", (store) => store.get(PACK_KEY))) ?? null);
}

export async function savePack(pack: OfflineDeskPack) {
  await run(PACK_STORE, "readwrite", (store) => store.put(pack, PACK_KEY));
}

export async function loadEntries(): Promise<OfflineDeskEntry[]> {
  const rows = (await run<StoredEntry[]>(ENTRY_STORE, "readonly", (store) => store.getAll())) ?? [];
  return rows
    .map(({ key: _key, ...entry }) => entry)
    .sort((a, b) => a.reservedSerial - b.reservedSerial);
}

export async function putEntry(entry: OfflineDeskEntry) {
  const stored: StoredEntry = { ...entry, key: entryKey(entry.workbookId, entry.slotNumber) };
  await run(ENTRY_STORE, "readwrite", (store) => store.put(stored));
}

export async function putEntries(entries: OfflineDeskEntry[]) {
  if (entries.length === 0) return;
  await run(ENTRY_STORE, "readwrite", (store) => {
    for (const entry of entries) {
      store.put({ ...entry, key: entryKey(entry.workbookId, entry.slotNumber) } satisfies StoredEntry);
    }
  });
}

export async function deleteEntry(workbookId: string, slotNumber: number) {
  await run(ENTRY_STORE, "readwrite", (store) => store.delete(entryKey(workbookId, slotNumber)));
}

export async function clearDesk() {
  await run(PACK_STORE, "readwrite", (store) => store.clear());
  await run(ENTRY_STORE, "readwrite", (store) => store.clear());
}

/** Asks the browser not to evict our data when disk space runs low. */
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage?.persist) return false;
    return (await navigator.storage.persisted()) || (await navigator.storage.persist());
  } catch {
    return false;
  }
}

export async function isStoragePersistent() {
  try {
    return (await navigator.storage?.persisted?.()) ?? false;
  } catch {
    return false;
  }
}
