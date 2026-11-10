/**
 * Saves the offline desk page and its scripts on this computer so it opens with
 * no internet. Talks to the service worker in public/offline-desk-sw.js.
 */

const WORKER_URL = "/offline-desk-sw.js";
export const OFFLINE_DESK_PATH = "/offline-desk";

export type ShellStatus = { ready: boolean; files: number };

function sameOrigin(value: string) {
  try {
    return new URL(value, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

/** Every file this page loaded, plus the page itself and its icons. */
function collectShellUrls() {
  const urls = new Set<string>([OFFLINE_DESK_PATH, "/manifest.json", "/company-logo.svg", "/favicon.ico"]);
  for (const entry of performance.getEntriesByType("resource")) {
    if (!sameOrigin(entry.name)) continue;
    const { pathname, search } = new URL(entry.name);
    if (pathname.startsWith("/_serverFn") || pathname.startsWith("/api/")) continue;
    urls.add(pathname + search);
  }
  document
    .querySelectorAll<HTMLLinkElement | HTMLScriptElement>(
      "link[rel=stylesheet], link[rel=modulepreload], script[src]",
    )
    .forEach((node) => {
      const value = node instanceof HTMLLinkElement ? node.href : node.src;
      if (value && sameOrigin(value)) {
        const { pathname, search } = new URL(value);
        urls.add(pathname + search);
      }
    });
  return [...urls];
}

function ask<T>(worker: ServiceWorker, message: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => reject(new Error("The offline page did not answer in time.")), 60_000);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data as T);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

export function offlineShellSupported() {
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof caches !== "undefined";
}

async function activeWorker() {
  const registration = await navigator.serviceWorker.register(WORKER_URL, { scope: "/" });
  await navigator.serviceWorker.ready;
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  if (!worker) throw new Error("The offline helper did not start. Reload the page and try again.");
  return worker;
}

export async function saveOfflineShell() {
  if (!offlineShellSupported()) {
    throw new Error("This browser cannot work offline. Use the latest Chrome or Edge on https.");
  }
  const worker = await activeWorker();
  const result = await ask<{ ok: boolean; saved?: number; failed?: number; error?: string }>(worker, {
    type: "cache-shell",
    urls: collectShellUrls(),
  });
  if (!result.ok) throw new Error(result.error ?? "Could not save the offline page.");
  return { saved: result.saved ?? 0, failed: result.failed ?? 0 };
}

/** For testing only: removes the offline helper and its saved page so the next load is fresh. */
export async function removeOfflineShell() {
  if (!offlineShellSupported()) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((registration) => registration.unregister()));
  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith("titan-offline-desk-")).map((name) => caches.delete(name)));
}

export async function readShellStatus(): Promise<ShellStatus> {
  if (!offlineShellSupported()) return { ready: false, files: 0 };
  try {
    const registration = await navigator.serviceWorker.getRegistration("/");
    const worker = registration?.active;
    if (!worker) return { ready: false, files: 0 };
    const result = await ask<{ ok: boolean; ready?: boolean; files?: number }>(worker, { type: "status" });
    return { ready: Boolean(result.ready), files: result.files ?? 0 };
  } catch {
    return { ready: false, files: 0 };
  }
}
