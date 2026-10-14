// No caching or background timer: this worker only displays/clicks desktop alerts.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:"window",includeUncontrolled:true});
    const url = event.notification.data?.url;
    const existing = windows.find((client) => client.url === url);
    if (existing) return existing.focus();
    if (url && new URL(url).origin === self.location.origin) return self.clients.openWindow(url);
  })());
});
