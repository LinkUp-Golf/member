// ============================================================
// LinkUp Golf — Custom Service Worker
//
// Handles the full push notification lifecycle:
//   install     — skip waiting so updates activate immediately
//   activate    — claim clients + prune old caches
//   push        — parse payload, show notification
//   notificationclick — focus existing tab or open new window
//   notificationclose — (analytics hook, no-op)
//   fetch       — offline navigation fallback
//
// This file is imported by next-pwa and merged with the
// generated Workbox service worker via the customWorkerDir
// option.  Keep it self-contained — no ES module imports.
// ============================================================

var APP_NAME   = 'LinkUp Golf'
var ICON_192   = '/icons/icon-192.png'
var BADGE_ICON = '/icons/icon-192.png'
var FALLBACK   = '/'

// ---- install: activate immediately --------------------------

self.addEventListener('install', function (event) {
  event.waitUntil(self.skipWaiting())
})

// ---- activate: claim clients, prune old caches --------------

self.addEventListener('activate', function (event) {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) { return k.startsWith('linkup-runtime-') })
            .map(function (k) { return caches.delete(k) })
        )
      }),
    ])
  )
})

// ---- push: receive notification + show to user --------------

self.addEventListener('push', function (event) {
  event.waitUntil(
    (function () {
      var payload = null
      try {
        if (event.data) payload = event.data.json()
      } catch (_) {
        // malformed JSON — fall through to defaults
      }

      var title   = payload && payload.title  ? String(payload.title).slice(0, 100) : APP_NAME
      var body    = payload && payload.body   ? String(payload.body).slice(0, 300)  : 'New notification'
      var icon    = payload && payload.icon   ? payload.icon   : ICON_192
      var badge   = payload && payload.badge  ? payload.badge  : BADGE_ICON
      var tag     = payload && payload.tag    ? payload.tag    : 'linkup-default'
      var image   = payload && payload.image  ? payload.image  : undefined
      var url     = payload && payload.data && payload.data.url ? payload.data.url : FALLBACK
      var vibrate = payload && Array.isArray(payload.vibrate)   ? payload.vibrate  : [200, 100, 200]
      var requireInteraction = !!(payload && payload.requireInteraction)

      // Build action buttons (max 2, sanitised)
      var actions = []
      if (payload && Array.isArray(payload.actions)) {
        payload.actions.slice(0, 2).forEach(function (a) {
          if (a && typeof a.action === 'string' && typeof a.title === 'string') {
            actions.push({
              action: a.action,
              title:  a.title.slice(0, 50),
              icon:   a.icon || undefined,
            })
          }
        })
      }
      if (!actions.length) {
        actions = [
          { action: 'open',    title: 'Open'    },
          { action: 'dismiss', title: 'Dismiss' },
        ]
      }

      var options = {
        body:               body,
        icon:               icon,
        badge:              badge,
        tag:                tag,
        renotify:           true,
        requireInteraction: requireInteraction,
        vibrate:            vibrate,
        data:               { url: url },
        actions:            actions,
      }
      if (image) options.image = image

      // Deduplicate: skip if the same tag+body is already visible
      return self.registration.getNotifications({ tag: tag }).then(function (existing) {
        if (existing.length > 0 && existing[0].body === body) return
        return self.registration.showNotification(title, options)
      })
    })()
  )
})

// ---- notificationclick: focus tab or open window ------------

self.addEventListener('notificationclick', function (event) {
  event.notification.close()

  if (event.action === 'dismiss') return

  var url     = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : FALLBACK
  var fullUrl = new URL(url, self.location.origin).href

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        // Focus an existing same-origin tab and navigate it
        for (var i = 0; i < clientList.length; i++) {
          var c = clientList[i]
          if (c.url.startsWith(self.location.origin) && 'focus' in c) {
            c.focus()
            if ('navigate' in c) return c.navigate(fullUrl)
            return
          }
        }
        // No existing tab — open a new window
        if (self.clients.openWindow) {
          return self.clients.openWindow(fullUrl)
        }
      })
  )
})

// ---- notificationclose: no-op hook for future analytics -----

self.addEventListener('notificationclose', function (event) {
  event.waitUntil(Promise.resolve())
})

// ---- fetch: offline navigation fallback ---------------------
// Workbox handles all asset/API caching; this only covers
// page navigations when the user is genuinely offline.

self.addEventListener('fetch', function (event) {
  if (event.request.mode !== 'navigate') return

  event.respondWith(
    fetch(event.request).catch(function () {
      return caches.match('/offline') || caches.match(FALLBACK) || new Response(
        '<!doctype html><html lang="en"><head>' +
        '<meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width,initial-scale=1">' +
        '<title>Offline — LinkUp Golf</title>' +
        '<style>' +
        'body{font-family:sans-serif;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;min-height:100vh;' +
        'margin:0;background:#F4F1E8;color:#1A2E1A;text-align:center;padding:1rem}' +
        'h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#555;max-width:30ch}' +
        '</style></head><body>' +
        '<h1>You\'re offline</h1>' +
        '<p>Check your connection and try again.</p>' +
        '</body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
      )
    })
  )
})
