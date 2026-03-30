// ============================================================
// OneCad BIM — Service Worker for Push Notifications
// ============================================================
const CACHE_NAME = 'bim-sw-v1'
const APP_ORIGIN = self.location.origin

// ── Install & Activate ──────────────────────────────────────
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()))

// ── Push event: hiển thị native notification ────────────────
self.addEventListener('push', event => {
  let data = {}
  try { data = event.data?.json() || {} } catch { data = { title: 'OneCad BIM', body: event.data?.text() || 'Có thông báo mới' } }

  const title   = data.title || 'OneCad BIM'
  const options = {
    body:    data.body  || 'Bạn có thông báo mới',
    icon:    data.icon  || '/icon-192.png',
    badge:   '/badge-72.png',
    tag:     data.tag   || 'bim-notif',
    data:    { url: data.url || '/', notifId: data.notifId, relatedType: data.relatedType, relatedId: data.relatedId },
    vibrate: [200, 100, 200],
    renotify: true,
    requireInteraction: false,
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

// ── Notification click: focus / open tab ────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const { url, notifId, relatedType, relatedId } = event.notification.data || {}

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      // Try to focus existing tab
      const existing = clients.find(c => c.url.startsWith(APP_ORIGIN))
      if (existing) {
        existing.focus()
        existing.postMessage({ type: 'NOTIF_CLICK', notifId, relatedType, relatedId })
        return
      }
      // No tab open — open new one
      return self.clients.openWindow(url || '/')
    })
  )
})

// ── Message from page: skip waiting (used for SW update) ────
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
