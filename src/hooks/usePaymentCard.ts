'use client'

// The member's card on file, and whether the cancellation policy is on.
//
// `enabled` false means Stripe isn't configured: nothing asks for a card and no
// cancellation costs anything, so every screen reading this hides the policy.

import { useCallback, useEffect, useState } from 'react'
import type { SavedCard } from '@/lib/stripe/card'
import { useStripePublishableKey } from '@/components/providers/StripeKeyProvider'

export interface PaymentCardState {
  enabled: boolean
  /**
   * Whether to state the policy now. The policy is fixed text, so it doesn't
   * wait on the request: until that answers, the publishable key the (app)
   * layout handed down stands in for `enabled`. Only the card itself waits.
   */
  showPolicy: boolean
  card: SavedCard | null
  loading: boolean
  /** Adopt a card the form just saved, without another round-trip. */
  setCard: (card: SavedCard | null) => void
  refresh: () => Promise<void>
}

export function usePaymentCard(active = true): PaymentCardState {
  const stripeConfigured = Boolean(useStripePublishableKey())
  const [enabled, setEnabled] = useState(false)
  const [card, setCard] = useState<SavedCard | null>(null)
  const [loading, setLoading] = useState(active)

  const refresh = useCallback(async () => {
    if (!active) return
    try {
      const res = await fetch('/api/payments/card')
      const json = await res.json().catch(() => ({}))
      if (res.ok) {
        setEnabled(json.enabled === true)
        setCard(json.card ?? null)
      }
    } catch {
      // Unreadable reads as "policy off": the screen then shows no fee and asks
      // for no card, and the server, which does know, still enforces both.
    } finally {
      setLoading(false)
    }
  }, [active])

  useEffect(() => { refresh() }, [refresh])

  const showPolicy = loading ? stripeConfigured : enabled

  return { enabled, showPolicy, card, loading, setCard, refresh }
}
