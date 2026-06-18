'use client'

// ============================================================
// usePushNotifications
//
// SSR-safe, race-condition-safe React hook for Web Push.
//
// Exposed API:
//   permission          — 'default' | 'granted' | 'denied' | 'unsupported'
//   isSupported         — Push API available in this browser
//   isSubscribed        — active push subscription exists
//   isLoading           — async operation in flight
//   subscribe()         — request permission + subscribe (idempotent)
//   unsubscribe()       — remove subscription from browser + server
//   sendTestNotification() — fire a visible test notification
//
// Backward-compat aliases (used by the settings page):
//   subscribed          → isSubscribed
//   requesting          → isLoading
//   requestPermission() → subscribe()
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react'

export type PushPermission = 'default' | 'granted' | 'denied' | 'unsupported'

export interface UsePushNotificationsReturn {
  permission:           PushPermission
  isSupported:          boolean
  isSubscribed:         boolean
  isLoading:            boolean
  subscribe:            () => Promise<boolean>
  unsubscribe:          () => Promise<void>
  sendTestNotification: () => Promise<boolean>
  // backward-compat
  subscribed:           boolean
  requesting:           boolean
  requestPermission:    () => Promise<boolean>
}

// Push API requires browser — guard for SSR and older browsers.
function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification'  in window &&
    'serviceWorker' in navigator &&
    'PushManager'   in window
  )
}

// Convert a URL-safe base64 VAPID public key to the Uint8Array
// BufferSource that PushManager.subscribe() requires.
// Allocating through ArrayBuffer produces Uint8Array<ArrayBuffer>
// (not ArrayBufferLike), satisfying the strict TS constraint.
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw  = window.atob(padded)
  const buf  = new ArrayBuffer(raw.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
  return view
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const supported = isPushSupported()

  const [permission,   setPermission]   = useState<PushPermission>(
    // Read initial permission synchronously — safe because this
    // component always renders in a browser context ('use client').
    supported ? (Notification.permission as PushPermission) : 'unsupported'
  )
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [isLoading,    setIsLoading]    = useState(false)

  // Prevent setState on unmounted component
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // ---- Immediately correct permission from the browser -------
  // Notification.permission is synchronously readable — no service
  // worker needed. This fixes the SSR hydration issue where useState
  // initialises to 'unsupported' (server has no window) and the value
  // is never corrected when no SW is registered (e.g. in development).
  useEffect(() => {
    if (!supported) return
    setPermission(Notification.permission as PushPermission)
  }, [supported])

  // ---- Sync subscription state on mount ----------------------
  // Also re-syncs when the controlling SW changes (PWA update).
  useEffect(() => {
    if (!supported) return
    let cancelled = false

    async function sync() {
      try {
        const reg = await navigator.serviceWorker.ready
        const sub = await reg.pushManager.getSubscription()
        if (!cancelled && mountedRef.current) {
          setIsSubscribed(!!sub)
          setPermission(Notification.permission as PushPermission)
        }
      } catch {
        // SW not yet registered — not subscribed
      }
    }

    sync()

    const onControllerChange = () => { if (!cancelled) sync() }
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)

    return () => {
      cancelled = true
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
    }
  }, [supported])

  // ---- subscribe() -------------------------------------------
  // Idempotent: PushManager.subscribe returns the existing
  // subscription if permission was already granted.
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!supported || isLoading) return false

    setIsLoading(true)
    try {
      const result = await Notification.requestPermission()
      if (mountedRef.current) setPermission(result as PushPermission)
      if (result !== 'granted') return false

      // Fetch VAPID public key (lightweight GET, no body)
      const keyRes = await fetch('/api/push/subscribe')
      if (!keyRes.ok) {
        console.error('[push] VAPID key fetch failed', keyRes.status)
        return false
      }
      const { publicKey } = (await keyRes.json()) as { publicKey: string }

      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })

      const json = sub.toJSON()
      const res  = await fetch('/api/push/subscribe', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ endpoint: json.endpoint, keys: json.keys }),
      })

      if (!res.ok) {
        console.error('[push] subscription save failed', res.status)
        return false
      }

      if (mountedRef.current) setIsSubscribed(true)
      return true
    } catch (err) {
      console.error('[push] subscribe error', err)
      return false
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [supported, isLoading])

  // ---- unsubscribe() ------------------------------------------
  const unsubscribe = useCallback(async (): Promise<void> => {
    if (!supported || isLoading) return

    setIsLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()

      if (sub) {
        const endpoint = sub.endpoint
        await sub.unsubscribe()
        await fetch('/api/push/unsubscribe', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ endpoint }),
        })
      }

      if (mountedRef.current) setIsSubscribed(false)
    } catch (err) {
      console.error('[push] unsubscribe error', err)
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [supported, isLoading])

  // ---- sendTestNotification() ---------------------------------
  const sendTestNotification = useCallback(async (): Promise<boolean> => {
    if (!supported || !isSubscribed || isLoading) return false

    setIsLoading(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const sub = await reg.pushManager.getSubscription()
      if (!sub) return false

      const json = sub.toJSON()
      const res  = await fetch('/api/push/send', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          endpoint: json.endpoint,
          p256dh:   json.keys?.p256dh,
          auth:     json.keys?.auth,
          notification: {
            title:   'LinkUp Golf — test notification',
            body:    'Notifications are working correctly.',
            tag:     'test-notification',
            url:     '/home',
            vibrate: [200, 100, 200],
          },
        }),
      })

      return res.ok
    } catch (err) {
      console.error('[push] sendTestNotification error', err)
      return false
    } finally {
      if (mountedRef.current) setIsLoading(false)
    }
  }, [supported, isSubscribed, isLoading])

  return {
    permission,
    isSupported:          supported,
    isSubscribed,
    isLoading,
    subscribe,
    unsubscribe,
    sendTestNotification,
    // backward-compat aliases
    subscribed:           isSubscribed,
    requesting:           isLoading,
    requestPermission:    subscribe,
  }
}
