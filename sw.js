/* Pledge Ledger service worker.
   Shell is cached so the app opens offline; Firebase traffic is never cached,
   because Firestore keeps its own offline store in IndexedDB. */
const VERSION = "pledge-ledger-v1";
const SHELL = VERSION + "-shell";
const RUNTIME = VERSION + "-runtime";

const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icon.png"
];

/* Hosts that must always go to the network: auth and live data. */
const NEVER_CACHE = [
  "firestore.googleapis.com",
  "identitytoolkit.googleapis.com",
  "securetoken.googleapis.com",
  "firebaseinstallations.googleapis.com",
  "www.googleapis.com",
  "accounts.google.com",
  "apis.google.com"
];

/* Hosts worth keeping a copy of: the SDK and the fonts. */
const RUNTIME_HOSTS = [
  "www.gstatic.com",
  "fonts.googleapis.com",
  "fonts.gstatic.com"
];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    // add one at a time so a single 404 doesn't abort the whole install
    await Promise.all(SHELL_FILES.map(f => c.add(f).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== SHELL && k !== RUNTIME).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => {
  if (e.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (NEVER_CACHE.some(h => url.hostname === h || url.hostname.endsWith("." + h))) return;

  /* Navigations: try the network so updates land, fall back to the cached shell. */
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const c = await caches.open(SHELL);
        c.put("./index.html", fresh.clone());
        return fresh;
      } catch {
        const c = await caches.open(SHELL);
        return (await c.match("./index.html")) || (await c.match("./")) || Response.error();
      }
    })());
    return;
  }

  const sameOrigin = url.origin === self.location.origin;
  const runtimeHost = RUNTIME_HOSTS.includes(url.hostname);
  if (!sameOrigin && !runtimeHost) return;

  /* Everything else: serve from cache, refresh in the background. */
  e.respondWith((async () => {
    const cacheName = sameOrigin ? SHELL : RUNTIME;
    const c = await caches.open(cacheName);
    const hit = await c.match(req);
    const net = fetch(req).then(res => {
      if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone());
      return res;
    }).catch(() => null);
    return hit || (await net) || Response.error();
  })());
});
