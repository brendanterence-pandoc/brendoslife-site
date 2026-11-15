// MedTrack service worker: shows reminder notifications and opens the app when one is tapped.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  // A notification is always shown. Browsers withdraw permission from apps that receive a push silently.
  event.waitUntil(
    self.registration.showNotification(data.title || "MedTrack", {
      body: data.body || "Time to check in.",
      tag: data.tag || undefined,
      renotify: Boolean(data.tag),
      icon: "./icon-192.png",
      badge: "./icon-192.png",
      data: { url: data.url || "./" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL((event.notification.data && event.notification.data.url) || "./", self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const w of windows) {
        if (w.url.startsWith(self.registration.scope) && "focus" in w) return w.focus();
      }
      return self.clients.openWindow(target);
    })(),
  );
});
