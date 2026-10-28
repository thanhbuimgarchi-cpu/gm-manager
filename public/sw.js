// Bump this whenever a release changes how locally cached data is handled.
// Activating a new shell removes the older UI that used to send every work
// note to Drive while it was being edited.
const CACHE_NAME = "gm-crm-shell-v11";
const APP_SHELL = ["./", "./manifest.webmanifest", "./gm-logo.png", "./gm-logo-192.png", "./gm-logo-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // GitHub Pages serves HTML and the service worker with a short HTTP cache.
  // A navigation must nevertheless obtain the newest app shell so an installed
  // phone/desktop app cannot remain on an older note-sync implementation.
  const request = event.request.mode === "navigate"
    ? new Request(event.request, { cache: "no-store" })
    : event.request;
  event.respondWith(fetch(request).then((response) => {
    const copy = response.clone();
    if (new URL(event.request.url).origin === self.location.origin) {
      caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
    }
    return response;
  }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./"))));
});

function notificationTargetUrl(value) {
  const scope = new URL(self.registration.scope);
  try {
    const target = new URL(String(value || "./"), scope);
    if (target.origin === scope.origin && target.pathname.startsWith(scope.pathname) && !target.username && !target.password) return target.href;
  } catch { /* An invalid notification target returns to the app overview. */ }
  return scope.href;
}

function notificationOptions(value = {}) {
  const payload = value && typeof value === "object" ? value : { body: String(value || "") };
  return {
    body: payload.body || "GM-CRM có cập nhật mới.",
    icon: "./gm-logo.png",
    badge: "./gm-logo.png",
    tag: payload.tag || "gm-crm-notification",
    renotify: payload.renotify !== false,
    data: { url: notificationTargetUrl(payload.url) },
  };
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
    return;
  }
  if (event.data?.type === "GM_CRM_NOTIFY") {
    event.waitUntil(self.registration.showNotification(event.data.title || "GM-CRM", notificationOptions(event.data)));
  }
});

self.addEventListener("push", (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; } catch { payload = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification((payload && payload.title) || "GM-CRM", notificationOptions(payload)));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = notificationTargetUrl(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const appWindows = windows.filter((client) => {
      try {
        const candidate = new URL(client.url);
        const scope = new URL(self.registration.scope);
        return candidate.origin === scope.origin && candidate.pathname.startsWith(scope.pathname);
      } catch { return false; }
    });
    const existing = appWindows.find((client) => client.url === target) || appWindows[0];
    if (existing) {
      try {
        const navigated = existing.url !== target ? await existing.navigate(target) : existing;
        await (navigated || existing).focus();
        return;
      } catch { /* A tab can close between enumeration and focus; open a new one. */ }
    }
    await self.clients.openWindow(target);
  })());
});
