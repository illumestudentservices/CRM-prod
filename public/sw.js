/**
 * Service worker for offline lead capture. Nothing else.
 *
 * Written by hand rather than generated, because a service worker is the one
 * thing on this site that can break every page for every user and keep doing it
 * after the bad deploy is reverted — it is installed on the device, not served
 * from it. That risk is worth taking only for a fetch handler small enough to
 * read in full, which is why this file does not attempt to be a general cache.
 *
 * What it touches:
 *   - the /students/offline document, so the page cold-starts with no signal
 *   - /_next/static/*, which are content-hashed and therefore safe to keep
 *
 * What it deliberately never touches:
 *   - anything under /api/, including auth. A cached API response would show an
 *     ICR stale leads, or worse, another session's data
 *   - any other navigation. Every other page must come from the network, or a
 *     deploy would leave people on a stale app with no way to tell
 *   - non-GET requests
 *
 * To disable in an emergency: replace this file's body with
 * `self.addEventListener("install", () => self.registration.unregister())` and
 * deploy. Registered workers check for an update on navigation, so devices pick
 * it up on their next visit.
 */

// Bump to invalidate every cache this worker owns. The activate handler deletes
// anything not matching, so an old build's assets cannot outlive a deploy.
const VERSION = "v1";
const DOC_CACHE = `illume-offline-doc-${VERSION}`;
const ASSET_CACHE = `illume-offline-assets-${VERSION}`;
const OFFLINE_PATH = "/students/offline";

self.addEventListener("install", (event) => {
  // Takes over without waiting for existing tabs to close. Safe here because
  // the worker owns no cross-page state — the alternative is an ICR installing
  // it and it not being active by the time they reach the venue.
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith("illume-offline-") && n !== DOC_CACHE && n !== ASSET_CACHE)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  if (request.method !== "GET") return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Same origin only. Fonts, analytics and anything else third-party go
  // straight to the network untouched.
  if (url.origin !== self.location.origin) return;

  // Never intercept the API. Serving a stale lead list or a cached session
  // would be worse than being offline.
  if (url.pathname.startsWith("/api/")) return;

  // Content-hashed build assets. Cache-first is safe precisely because the
  // filename changes when the content does, so a stale hit is impossible.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      (async () => {
        const hit = await caches.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) {
          const cache = await caches.open(ASSET_CACHE);
          cache.put(request, res.clone());
        }
        return res;
      })()
    );
    return;
  }

  // The capture page itself, and only on a real navigation — an RSC fetch for
  // client-side routing carries ?_rsc and must not be answered with a document.
  const isCaptureDocument =
    request.mode === "navigate" &&
    url.pathname === OFFLINE_PATH &&
    !url.searchParams.has("_rsc");

  if (isCaptureDocument) {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          // Only a 200 is worth keeping. Caching the 307 that proxy.ts returns
          // to a signed-out user would pin a redirect to /login in place of the
          // page, and it would survive signing back in.
          if (res.ok && res.status === 200) {
            const cache = await caches.open(DOC_CACHE);
            cache.put(request, res.clone());
          }
          return res;
        } catch {
          const hit = await caches.match(request);
          if (hit) return hit;
          // Cache miss while offline: the page was never loaded on this device,
          // so there is nothing to fall back to. Say so plainly rather than
          // letting the browser show its own error.
          return new Response(
            `<!doctype html><html><head><meta charset="utf-8">
             <meta name="viewport" content="width=device-width,initial-scale=1">
             <title>Offline</title></head>
             <body style="font-family:system-ui;padding:2rem;max-width:32rem;margin:0 auto;color:#1e293b">
             <h1 style="font-size:1.1rem">Not available offline yet</h1>
             <p style="font-size:.9rem;line-height:1.6;color:#475569">
             This device has not loaded the capture page while connected, so there is no
             copy to open. Reconnect once and open Offline Capture — after that it will
             work without a signal.</p></body></html>`,
            { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } }
          );
        }
      })()
    );
  }

  // Everything else falls through to the network untouched.
});
