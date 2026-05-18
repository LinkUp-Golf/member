'use client'

import { useState, useEffect, useCallback } from 'react'

type PermissionState = 'default' | 'granted' | 'denied' | 'unsupported'

interface UsePushNotificationsReturn {
  permission: PermissionState
  subscribed: boolean
  requesting: boolean
  requestPermission: () => Promise<boolean>
  unsubscribe: () => Promise<void>
}

export function usePushNotifications(): UsePushNotificationsReturn {
  const [permission, setPermission] = useState<PermissionState>('default')
  const [subscribed, setSubscribed] = useState(false)
  const [requesting, setRequesting] = useState(false)

  useEffect(() => {
    if (!('Notification' in window) || !('serviceWorker' in navigator)) {
      setPermission('unsupported')
      return
    }

    setPermission(Notification.permission as PermissionState)

    // Check if already subscribed
    checkExistingSubscription()
  }, [])

  async function checkExistingSubscription() {
    try {
      const registration = await navigator.serviceWorker.ready
      const existing = await registration.pushManager.getSubscription()
      setSubscribed(!!existing)
    } catch {
      setSubscribed(false)
    }
  }

  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!('Notification' in window)) return false
    setRequesting(true)

    try {
      // Request notification permission
      const result = await Notification.requestPermission()
      setPermission(result as PermissionState)

      if (result !== 'granted') {
        setRequesting(false)
        return false
      }

      // Get VAPID public key from server
      const keyRes = await fetch('/api/push/subscribe')
      if (!keyRes.ok) {
        setRequesting(false)
        return false
      }
      const { publicKey } = await keyRes.json()

      // Subscribe via service worker
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })

      // Send subscription to server
      const subData = subscription.toJSON()
      const saveRes = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          endpoint: subData.endpoint,
          keys: subData.keys,
        }),
      })

      if (saveRes.ok) {
        setSubscribed(true)
        setRequesting(false)
        return true
      }
    } catch (err) {
      console.error('Push subscription error:', err)
    }

    setRequesting(false)
    return false
  }, [])

  const unsubscribe = useCallback(async (): Promise<void> => {
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()

      if (subscription) {
        const endpoint = subscription.endpoint
        await subscription.unsubscribe()

        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint }),
        })
      }

      setSubscribed(false)
    } catch (err) {
      console.error('Unsubscribe error:', err)
    }
  }, [])

  return { permission, subscribed, requesting, requestPermission, unsubscribe }
}

// ---- Utility: convert base64 VAPID key to Uint8Array --------
// Explicitly allocating via ArrayBuffer ensures the return type is
// Uint8Array<ArrayBuffer> (not Uint8Array<ArrayBufferLike>), which
// satisfies the BufferSource constraint on PushSubscriptionOptionsInit.
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const buffer = new ArrayBuffer(rawData.length)
  const outputArray = new Uint8Array(buffer)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
