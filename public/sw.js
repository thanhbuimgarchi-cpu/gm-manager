const CACHE_NAME = "gm-crm-shell-v7";
const APP_SHELL = ["./", "./manifest.webmanifest", "./gm-logo.png", "./gm-logo-192.png", "./gm-logo-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(fetch(event.request).then((response) => {
    const copy = response.clone();
    if (new URL(event.request.url).origin === self.location.origin) {
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./"))));
});

function notificationOptions(payload = {}) {
  return {
    body: payload.body || "GM-CRM có cập nhật mới.",
    icon: "./gm-logo.png",
    badge: "./gm-logo.png",
    tag: payload.tag || "gm-crm-notification",
    data: { url: payload.url || "./" },
  };
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === "GM_CRM_NOTIFY") {
    self.registration.showNotification(event.data.title || "GM-CRM", notificationOptions(event.data));
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(payload.title || "GM-CRM", notificationOptions(payload)));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow(event.notification.data?.url || "./"));
});
