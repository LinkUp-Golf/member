'use client'

// /more/payments — the card a late cancellation is charged to, the policy that
// decides when, and what the member's late cancellations have cost.
//
// The page every fee notification links to. A fee the card on file couldn't
// cover is paid from here through Stripe Checkout; Stripe sends the member back
// with ?paid=<id>, and the webhook is what actually marks it paid — so the
// banner says it's received rather than waiting on that to land.

import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { format } from 'date-fns'
import AppShell from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui/Loading'
import CardOnFile, { CardOnFileSkeleton } from '@/components/payments/CardOnFile'
import CancellationPolicy from '@/components/payments/CancellationPolicy'
import { usePaymentCard } from '@/hooks/usePaymentCard'
import { formatRoundPrice } from '@/lib/bookings/price'
import type { CancellationFee, CancellationFeeStatus } from '@/types'

const STATUS_META: Record<CancellationFeeStatus, { label: string; color: string; bg: string }> = {
  paid:    { label: 'Paid',       color: '#15803d', bg: 'rgba(21,128,61,0.08)' },
  pending: { label: 'Processing', color: '#b45309', bg: 'rgba(180,83,9,0.08)' },
  unpaid:  { label: 'Due',        color: '#b91c1c', bg: 'rgba(185,28,28,0.08)' },
  waived:  { label: 'Waived',     color: '#6b7280', bg: 'rgba(107,114,128,0.08)' },
}

export default function PaymentsPage() {
  const searchParams = useSearchParams()
  const justPaid = searchParams?.get('paid') ?? null
  const payment = usePaymentCard()

  const [fees, setFees] = useState<CancellationFee[]>([])
  const [loadingFees, setLoadingFees] = useState(true)
  const [payingId, setPayingId] = useState<string | null>(null)
  const [payError, setPayError] = useState('')

  const loadFees = useCallback(async () => {
    try {
      const res = await fetch('/api/cancellation-fees')
      const json = await res.json().catch(() => ({}))
      if (res.ok) setFees(Array.isArray(json.fees) ? json.fees : [])
    } catch {
      // Keep whatever was shown; the list is a record, not a gate.
    } finally {
      setLoadingFees(false)
    }
  }, [])

  useEffect(() => { loadFees() }, [loadFees])

  async function pay(feeId: string) {
    setPayingId(feeId)
    setPayError('')
    try {
      const res = await fetch(`/api/cancellation-fees/${feeId}/checkout`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (res.ok && typeof json.url === 'string') {
        window.location.href = json.url
        return
      }
      setPayError(json.error ?? 'We couldn’t open the payment page. Try again.')
      // A 409 means it's no longer due — paid in another tab, say.
      if (res.status === 409) loadFees()
    } catch {
      setPayError('Network error. Check your connection and try again.')
    }
    setPayingId(null)
  }

  return (
    <AppShell title="Payments" description="Card on file &amp; cancellation fees">
      <div className="px-5 py-5 pb-8 space-y-6 md:max-w-2xl md:mx-auto">

        {justPaid && (
          <div
            className="rounded-2xl px-4 py-3 text-sm"
            style={{ background: 'rgba(21,128,61,0.06)', border: '1px solid rgba(21,128,61,0.18)', color: '#15803d' }}
          >
            Payment received, thank you. It can take a moment to show as paid below.
          </div>
        )}

        {!payment.showPolicy ? (
          <p className="text-sm" style={{ color: 'rgba(0,38,105,0.5)' }}>
            Card payments aren’t set up yet, so there’s nothing to manage here.
          </p>
        ) : (
          <>
            <section>
              <p className="section-label mb-3">Card on file</p>
              {payment.loading ? (
                <CardOnFileSkeleton />
              ) : (
                <CardOnFile
                  card={payment.card}
                  onSaved={payment.setCard}
                  onRemoved={() => payment.setCard(null)}
                />
              )}
            </section>

            <section>
              <p className="section-label mb-3">Cancellation policy</p>
              <div className="card px-4 py-4 space-y-2">
                <CancellationPolicy />
                <p className="text-xs" style={{ color: 'rgba(0,38,105,0.4)' }}>
                  Days are counted at the course, and each spot is charged to whoever cancels it.
                </p>
              </div>
            </section>
          </>
        )}

        {/* Shown whatever the policy's state — a fee charged while it was on
            is still owed, or still a receipt, if it's switched off later. */}
        {(loadingFees || fees.length > 0) && (
          <section>
            <p className="section-label mb-3">Cancellation fees</p>
            {loadingFees ? (
              <div className="flex justify-center py-6"><Spinner className="w-5 h-5" /></div>
            ) : (
              <div className="card">
                {fees.map((fee, i) => {
                  const meta = STATUS_META[fee.status] ?? STATUS_META.pending
                  return (
                    <div
                      key={fee.id}
                      className="flex items-center gap-3 px-4 py-3.5"
                      style={{ borderBottom: i < fees.length - 1 ? '0.5px solid rgba(0,38,105,0.06)' : 'none' }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate" style={{ color: 'var(--color-green-900)' }}>
                          {fee.course_name ?? 'Round'}
                        </p>
                        <p className="text-xs mt-0.5" style={{ color: 'rgba(0,38,105,0.45)' }}>
                          {format(new Date(`${fee.event_date}T12:00:00`), 'EEE, MMM d, yyyy')}
                          {' · '}{fee.percent}% of {formatRoundPrice(fee.price)}
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-sm font-semibold" style={{ color: 'var(--color-green-900)' }}>
                          {formatRoundPrice(fee.amount)}
                        </span>
                        {fee.status === 'unpaid' && payment.enabled ? (
                          <button
                            type="button"
                            onClick={() => pay(fee.id)}
                            disabled={payingId !== null}
                            className="btn btn-primary btn-sm disabled:opacity-50"
                          >
                            {payingId === fee.id ? <Spinner className="w-3.5 h-3.5" /> : 'Pay now'}
                          </button>
                        ) : (
                          <span
                            className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                            style={{ color: meta.color, background: meta.bg }}
                          >
                            {meta.label}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {payError && <p className="text-sm text-red-600 mt-2">{payError}</p>}
          </section>
        )}
      </div>
    </AppShell>
  )
}
