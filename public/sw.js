/* DukaanOS service worker — app-shell cache so the PWA opens with Wi-Fi OFF.
   API calls are never cached: offline writes go to the IndexedDB queue instead. */
const CACHE = "dukaanos-shell-v2";
const SHARE_CACHE = "dukaanos-share-v1";
const SHELL = [
  "/",
  "/verify",
  "/privacy",
  "/terms",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/apple-touch-icon.png",
  "/manifest.webmanifest",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (e) => {
  if (e.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;

  // Web Share Target: capture shared parchi image and redirect into the app
  if (e.request.method === "POST" && url.pathname === "/" && url.searchParams.get("share") === "parchi") {
    e.respondWith(
      (async () => {
        try {
          const fd = await e.request.formData();
          const file = fd.get("parchi");
          if (file instanceof File) {
            const cache = await caches.open(SHARE_CACHE);
            await cache.put("/shared-parchi", new Response(file, { headers: { "content-type": file.type || "image/jpeg" } }));
          }
        } catch {
          /* ignore malformed share payload */
        }
        return Response.redirect("/?share=parchi", 303);
      })(),
    );
    return;
  }

  if (e.request.method !== "GET" || url.pathname.startsWith("/api/")) return;

  // network-first for navigations, cache-first for static chunks & icons
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        })
        .catch(() => caches.match(e.request).then((r) => r || caches.match("/"))),
    );
    return;
  }

  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.endsWith(".svg") ||
    url.pathname.endsWith(".png") ||
    url.pathname.endsWith(".woff2")
  ) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
            return res;
          }),
      ),
    );
  }
});
