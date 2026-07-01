'use client'

// ============================================================
// useLocationTimezone
//
// Persists the member's timezone preference to member_profiles.
// Preferred source is GPS (via navigator.geolocation) — resolved to
// an IANA zone server-side by /api/profile. Falls back to the
// browser's Intl-detected zone when location is denied/unsupported,
// and supports a manual override (Settings timezone dropdown).
// ============================================================

import { useState, useCallback, useEffect } from 'react'
import { getBrowserTimezone } from '@/lib/timezone'

export type GeoPermission = 'default' | 'granted' | 'denied' | 'unsupported'

export interface UseLocationTimezoneReturn {
  permission: GeoPermission
  isSupported: boolean
  isLoading: boolean
  detectFromLocation: () => Promise<boolean>
  setManualTimezone: (timezone: string) => Promise<boolean>
}

function isGeolocationSupported(): boolean {
  return typeof navigator !== 'undefined' && 'geolocation' in navigator
}

async function patchProfile(body: Record<string, unknown>): Promise<boolean> {
  const res = await fetch('/api/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res.ok
}

export function useLocationTimezone(refetch?: () => Promise<void>): UseLocationTimezoneReturn {
  const supported = isGeolocationSupported()

  const [permission, setPermission] = useState<GeoPermission>(supported ? 'default' : 'unsupported')
  const [isLoading, setIsLoading] = useState(false)

  // Sync with any permission already granted/denied in a previous session,
  // via the Permissions API — not supported on all browsers (e.g. Safari).
  useEffect(() => {
    if (!supported || !navigator.permissions?.query) return
    navigator.permissions.query({ name: 'geolocation' as PermissionName })
      .then(status => setPermission(status.state as GeoPermission))
      .catch(() => {})
  }, [supported])

  const detectFromLocation = useCallback(async (): Promise<boolean> => {
    if (!supported || isLoading) return false

    setIsLoading(true)
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 10_000,
        })
      }).catch((err: GeolocationPositionError) => {
        setPermission(err.code === err.PERMISSION_DENIED ? 'denied' : 'default')
        return null
      })

      if (position) {
        const ok = await patchProfile({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        })
        if (ok) setPermission('granted')
        if (ok) await refetch?.()
        return ok
      }

      // Denied or failed — fall back to persisting the browser-detected zone
      // so there's always a saved preference rather than leaving it null.
      const ok = await patchProfile({ timezone: getBrowserTimezone() })
      if (ok) await refetch?.()
      return ok
    } finally {
      setIsLoading(false)
    }
  }, [supported, isLoading, refetch])

  const setManualTimezone = useCallback(async (timezone: string): Promise<boolean> => {
    const ok = await patchProfile({ timezone })
    if (ok) await refetch?.()
    return ok
  }, [refetch])

  return {
    permission,
    isSupported: supported,
    isLoading,
    detectFromLocation,
    setManualTimezone,
  }
}
