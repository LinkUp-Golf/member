// Custom service worker code — bundled by next-pwa into the generated sw.js.
// Handles push notifications and the offline navigation fallback.

self.addEventListener('push', function (event) {
  if (!event.data) return

  let data
  try {
    data = event.data.json()
  } catch {
    data = { title: 'LinkUp Golf', body: event.data.text() }
  }

  const options = {
    body: data.body ?? '',
    icon: data.icon ?? '/icons/icon-192.png',
    badge: data.badge ?? '/icons/icon-192.png',
    tag: data.tag ?? 'linkup-notification',
    renotify: true,
    data: {
      url: data.data?.url ?? '/',
    },
    actions: [
      { action: 'open', title: 'Open' },
      { action: 'dismiss', title: 'Dismiss' },
    ],
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      // Skip the system banner if the user is actively looking at the app.
      const appIsVisible = clientList.some(function (client) {
        return client.visibilityState === 'visible'
      })

      if (appIsVisible) return

      return self.registration.showNotification(data.title ?? 'LinkUp Golf', options)
    })
  )
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()

  if (event.action === 'dismiss') return

  const url = event.notification.data?.url ?? '/'
  const fullUrl = new URL(url, self.location.origin).href

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus()
          client.navigate(fullUrl)
          return
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(fullUrl)
      }
    })
  )
})

self.addEventListener('fetch', function (event) {
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(function () {
        return caches.match('/offline') || new Response(
          '<html><body style="font-family:sans-serif;text-align:center;padding:60px"><h1>You\'re offline</h1><p>Please check your connection and try again.</p></body></html>',
          { headers: { 'Content-Type': 'text/html' } }
        )
      })
    )
  }
})
