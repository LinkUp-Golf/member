'use client'

import { useCallback, useEffect, useState } from 'react'
import { isCouponUsable } from '@/lib/credits'
import type { CreditCoupon, CreditSummary } from '@/types'

// ============================================================
// The member's credit, wherever they might spend it.
//
// Paying with credit shows up on screens whose main job is something else — the
// payment banner on Book, a hosted event's detail — and each of them needs the
// same two facts before it can offer the option: is there a balance, and is
// there already a code for this round. Rather than have each screen fetch and
// interpret that, they take this.
//
// `enabled` exists because most visitors have no credit at all: the hook is
// mounted on member screens generally, so the request is only worth making once
// there's a signed-in member to make it for.
// ============================================================

interface CreditWallet {
  balance: number
  /** False for a host or partner who has credit but no membership to spend it on. */
  canRedeem: boolean
  coupons: CreditCoupon[]
  loading: boolean
  /** The live code for a booking row, if the member already has one. */
  couponForBooking: (bookingId: string) => CreditCoupon | null
  /** The live code for a hosted round, if the member already has one. */
  couponForEvent: (eventId: string) => CreditCoupon | null
  /** True when there's credit to spend and a membership to spend it against. */
  canPayWithCredit: boolean
  /**
   * Whether credit can settle a bill of this size. A code has to pay a round in
   * full — a part-paying code fails at the checkout — so a balance short of the
   * price is no use here, and the surfaces that offer credit ask this rather
   * than just whether a balance exists.
   */
  coversBill: (price: number) => boolean
  refetch: () => void
}

export function useCreditWallet(enabled: boolean): CreditWallet {
  const [summary, setSummary] = useState<CreditSummary | null>(null)
  const [coupons, setCoupons] = useState<CreditCoupon[]>([])
  const [canRedeem, setCanRedeem] = useState(false)
  const [loading, setLoading] = useState(enabled)

  const load = useCallback(async () => {
    if (!enabled) return
    try {
      // No ?sync=1 — reconciling against GHL costs a round-trip per open code,
      // and nothing here is worth making a booking screen wait for. The wallet
      // page and the daily cron do that.
      const res = await fetch('/api/credits/coupons')
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setSummary(json.summary ?? null)
        setCoupons(json.coupons ?? [])
        setCanRedeem(json.canRedeem === true)
      }
    } catch {
      // A wallet we couldn't read is treated as no credit: the screens using
      // this just don't offer the option, which is the safe way to be wrong.
    } finally {
      setLoading(false)
    }
  }, [enabled])

  useEffect(() => { load() }, [load])

  const balance = summary?.balance ?? 0

  const couponForBooking = useCallback(
    (bookingId: string) =>
      coupons.find(c => c.booking_id === bookingId && isCouponUsable(c)) ?? null,
    [coupons]
  )

  const couponForEvent = useCallback(
    (eventId: string) =>
      coupons.find(c => c.hosted_event_id === eventId && isCouponUsable(c)) ?? null,
    [coupons]
  )

  const coversBill = useCallback(
    (price: number) => canRedeem && balance > 0 && Number.isFinite(price) && balance >= price,
    [canRedeem, balance]
  )

  return {
    balance,
    canRedeem,
    coupons,
    loading,
    couponForBooking,
    couponForEvent,
    canPayWithCredit: balance > 0 && canRedeem,
    coversBill,
    refetch: load,
  }
}
