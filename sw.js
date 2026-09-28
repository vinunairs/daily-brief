/* Daily Brief — service worker: shows the daily notification and opens the app when tapped.
   It does not cache pages, so updates always load right away. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Your Daily Brief is ready", {
    body: d.body || "Ten minutes: today's news, a reasoning workout and a life skill.",
    icon: "icons/icon-192.png",
    badge: "icons/badge-96.png",
    tag: d.tag || "brief-daily",
    renotify: true,
    data: { url: d.url || "./" }
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
    for (const w of wins) if (w.url.includes("/daily-brief/") && "focus" in w) return w.focus();
    return self.clients.openWindow(url);
  }));
});
