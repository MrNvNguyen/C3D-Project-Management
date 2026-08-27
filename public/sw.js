// ============================================================
// OneCad BIM — Service Worker (Push + optional shell icon cache)
// ============================================================
const CACHE_NAME = 'bim-sw-v4'
const APP_ORIGIN = self.location.origin

// Shell-only assets (NOT HTML/JS SPA — avoid stale finance UI)
const PRECACHE = [
  '/icon-192.png',
  '/icon-512.png',
  '/badge-72.png',
  '/manifest.webmanifest',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

// Network-first for everything; only cache-first for precached icons/manifest.
// Never intercept /api/* for caching.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url)
  if (url.origin !== APP_ORIGIN) return
  if (url.pathname.startsWith('/api/')) return
  if (event.request.method !== 'GET') return

  const isPrecache = PRECACHE.some((p) => url.pathname === p)
  if (!isPrecache) return

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached
      return fetch(event.request).then((res) => {
        if (res && res.ok) {
          const copy = res.clone()
          caches.open(CACHE_NAME).then((c) => c.put(event.request, copy)).catch(() => {})
        }
        return res
      })
    })
  )
})

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
      const existing = clients.find(c => c.url.startsWith(APP_ORIGIN))
      if (existing) {
        existing.focus()
        existing.postMessage({ type: 'NOTIF_CLICK', notifId, relatedType, relatedId })
        return
      }
      return self.clients.openWindow(url || '/')
    })
  )
})

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
