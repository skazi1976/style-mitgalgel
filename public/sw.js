const CACHE = "smg-v86";
const SHELL = ["/", "/style.css", "/app.js", "/firebase-auth.js", "/manifest.json", "/icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.pathname.startsWith("/api/")) return;

  // App CODE (navigations, HTML, JS) → network-first so updates ALWAYS load.
  // Previously stale-while-revalidate served old code first, so fixes never
  // reached the installed TWA. Falls back to cache only when offline.
  const isCode = e.request.mode === "navigate"
    || url.pathname === "/"
    || url.pathname.endsWith(".js")
    || url.pathname.endsWith(".html");

  if (isCode) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res && res.status === 200 && url.origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // Other assets (css, images, fonts) → stale-while-revalidate (fast).
  e.respondWith(
    caches.match(e.request).then((cached) => {
      const net = fetch(e.request)
        .then((res) => {
          if (res && res.status === 200 && url.origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});

// ---------- Push notifications ----------
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data?.text?.() || "" }; }

  const title = data.title || "סטייל מתגלגל";
  const options = {
    body:  data.body  || "",
    icon:  data.icon  || "/icon-192.png",
    badge: data.badge || "/icon-192.png",
    image: data.image,
    tag:   data.tag,
    data:  {
      url: data.url || "/",
      campaignId: data.campaignId || null,
      userId: data.userId ?? null,
    },
    dir:   "rtl",
    lang:  "he",
    vibrate: [120, 60, 120],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const d = event.notification.data || {};
  const targetUrl = d.url || "/";

  // Fire-and-forget click tracking — don't block navigation
  if (d.campaignId) {
    const reportUrl = new URL("/api/push/click", self.location.origin).toString();
    fetch(reportUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      keepalive: true,
      body: JSON.stringify({
        campaignId: d.campaignId,
        userId: d.userId,
        url: targetUrl,
      }),
    }).catch(() => {});
  }

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      for (const w of wins) {
        if (w.url.includes(new URL(targetUrl, self.location.origin).pathname) && "focus" in w) return w.focus();
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});
