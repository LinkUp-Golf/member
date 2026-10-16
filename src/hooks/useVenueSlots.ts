'use client'

import { useEffect, useMemo, useState } from 'react'
import type { GHLBookingSlot } from '@/types'

// The open tee times at one venue on one day, for the admin booking screens.
//
// Read from GET /api/bookings/create — the same endpoint, and so the same
// slots (curated where the venue curates that date, its GHL calendar
// otherwise), that a member booking is offered. Fetched a month at a time,
// which is how that endpoint answers, so stepping between days in one month
// costs nothing.

export function slotWallTime(startTime: string): string {
  // startTime carries the venue's own offset, so its wall-clock time is the
  // string's own — 'HH:mm', no re-zoning in the admin's browser.
  return (startTime.split('T')[1] ?? '').slice(0, 5)
}

export function useVenueSlots(courseId: string | null | undefined, date: string) {
  const [slotsByDate, setSlotsByDate] = useState<Record<string, GHLBookingSlot[]>>({})
  const [loadedKey, setLoadedKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const month = date.slice(0, 7)
  const key = courseId && month ? `${courseId}|${month}` : ''

  useEffect(() => {
    if (!key || key === loadedKey) return
    let cancelled = false
    setLoading(true)
    setError('')
    fetch(`/api/bookings/create?month=${month}&courseId=${courseId}`)
      .then(async r => {
        const d = await r.json().catch(() => ({}))
        if (cancelled) return
        if (!r.ok) {
          setSlotsByDate({})
          setError(d.error ?? 'Could not load tee times.')
        } else {
          setSlotsByDate(d.slots ?? {})
        }
        setLoadedKey(key)
      })
      .catch(() => {
        if (!cancelled) {
          setSlotsByDate({})
          setError('Could not load tee times.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [key, loadedKey, month, courseId])

  const openSlots = useMemo(
    () => (key === loadedKey ? (slotsByDate[date] ?? []) : []).filter(s => s.available && (s.spotsOpen ?? 0) > 0),
    [slotsByDate, date, key, loadedKey],
  )

  return { openSlots, loading: loading || (!!key && key !== loadedKey), error }
}
