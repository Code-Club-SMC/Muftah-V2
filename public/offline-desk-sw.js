/*
 * Offline desk service worker.
 *
 * It keeps just enough of the app on the factory computer that the offline
 * invoice desk opens with no internet. It never touches server functions, API
 * calls or any other page, so the rest of the app behaves exactly as before.
 *
 * The page tells us which files it needs ("cache-shell"). We save that exact
 * set in a new cache, then delete older caches, so the saved page and the saved
 * scripts always belong to the same release.
 */
const CACHE_PREFIX = "titan-offline-desk-";
const DESK_PATH = "/offline-desk";
const NETWORK_TIMEOUT_MS = 4000;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

async function currentCacheNames() {
  return (await caches.keys()).filter((name) => name.startsWith(CACHE_PREFIX)).sort();
}

async function cacheShell(urls) {
  const name = CACHE_PREFIX + Date.now();
  const cache = await caches.open(name);
  let saved = 0;
  const failed = [];
  for (const url of urls) {
    try {
      const response = await fetch(url, { credentials: "same-origin", cache: "reload" });
      if (response.ok && !response.redirected) {
        await cache.put(url, response);
        saved += 1;
      } else {
        failed.push(url);
      }
    } catch {
      failed.push(url);
    }
  }
  if (!(await cache.match(DESK_PATH))) {
    await caches.delete(name);
    throw new Error("Could not save the offline invoice page. Check the internet and try again.");
  }
  for (const other of await currentCacheNames()) {
    if (other !== name) await caches.delete(other);
  }
  return { saved, failed: failed.length };
}

async function shellStatus() {
  const names = await currentCacheNames();
  if (names.length === 0) return { ready: false, files: 0 };
  const cache = await caches.open(names[names.length - 1]);
  const keys = await cache.keys();
  const hasPage = Boolean(await cache.match(DESK_PATH));
  return { ready: hasPage, files: keys.length };
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  const port = event.ports && event.ports[0];
  const reply = (payload) => port && port.postMessage(payload);
  if (data.type === "cache-shell" && Array.isArray(data.urls)) {
    event.waitUntil(
      cacheShell(data.urls).then(
        (result) => reply({ ok: true, ...result }),
        (error) => reply({ ok: false, error: String(error && error.message ? error.message : error) }),
      ),
    );
  } else if (data.type === "status") {
    event.waitUntil(shellStatus().then((result) => reply({ ok: true, ...result })));
  }
});

function networkFirstWithTimeout(request) {
  return new Promise((resolve) => {
    let settled = false;
    const useCache = async () => {
      const cached = await caches.match(DESK_PATH, { ignoreSearch: true });
      return cached || null;
    };
    const finish = (response) => {
      if (settled) return;
      settled = true;
      resolve(response);
    };
    const timer = setTimeout(async () => {
      const cached = await useCache();
      if (cached) finish(cached);
    }, NETWORK_TIMEOUT_MS);
    fetch(request)
      .then((response) => {
        clearTimeout(timer);
        finish(response);
      })
      .catch(async () => {
        clearTimeout(timer);
        const cached = await useCache();
        finish(cached || Response.error());
      });
  });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/_serverFn") || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    if (url.pathname === DESK_PATH || url.pathname === DESK_PATH + "/") {
      event.respondWith(networkFirstWithTimeout(request));
    }
    return;
  }

  // Built files carry a content hash in their name, so a saved copy is always
  // the right one and can be used without asking the server.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then((cached) => cached || fetch(request)),
    );
    return;
  }

  // Everything else (icons, and every file the dev server hands out) must be
  // fresh whenever the server answers. The saved copy is only the fallback when
  // it cannot be reached, so code changes show up without clearing anything.
  event.respondWith(
    fetch(request).catch(async () => (await caches.match(request)) || Response.error()),
  );
});
