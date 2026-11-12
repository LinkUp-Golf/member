'use client'

// /more/payments — the cancellation policy, and what the member's late
// cancellations have cost.
//
// Each fee is a Stripe invoice. "Pay invoice" opens Stripe's invoice page in a
// new tab (issuing the invoice first if Stripe couldn't be reached when they
// cancelled); "Invoice" downloads it as a PDF. The webhook is what marks a fee
// paid, so the list is re-read when the member comes back to this tab.

import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import AppShell from '@/components/layout/AppShell'
import { Spinner } from '@/components/ui/Loading'
import CancellationPolicy from '@/components/payments/CancellationPolicy'
import { useCancellationPolicyOn } from '@/components/providers/CancellationPolicyProvider'
import { formatRoundPrice } from '@/lib/bookings/price'
import type { CancellationFee, CancellationFeeStatus } from '@/types'

const STATUS_META: Record<CancellationFeeStatus, { label: string; color: string; bg: string }> = {
  paid:    { label: 'Paid',    color: '#15803d', bg: 'rgba(21,128,61,0.08)' },
  pending: { label: 'Due',     color: '#b91c1c', bg: 'rgba(185,28,28,0.08)' },
  unpaid:  { label: 'Due',     color: '#b91c1c', bg: 'rgba(185,28,28,0.08)' },
  waived:  { label: 'Waived',  color: '#6b7280', bg: 'rgba(107,114,128,0.08)' },
}

const owed = (fee: CancellationFee) => fee.status === 'unpaid' || fee.status === 'pending'

export default function PaymentsPage() {
  const policyOn = useCancellationPolicyOn()

  const [fees, setFees] = useState<CancellationFee[]>([])
  const [loadingFees, setLoadingFees] = useState(true)
  const [openingId, setOpeningId] = useState<string | null>(null)
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

  // Back from paying on Stripe's page in another tab: show what's settled.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') loadFees() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [loadFees])

  async function openInvoice(fee: CancellationFee) {
    setPayError('')
    // Opened in the click itself, so a popup blocker lets it through; pointed
    // at the invoice once there is one.
    const tab = window.open(fee.invoice_url ?? 'about:blank', '_blank', 'noopener')
    if (fee.invoice_url) return

    setOpeningId(fee.id)
    try {
      const res = await fetch(`/api/cancellation-fees/${fee.id}/invoice`, { method: 'POST' })
      const json = await res.json().catch(() => ({}))
      if (res.ok && typeof json.url === 'string') {
        if (tab) tab.location.href = json.url
        else window.location.href = json.url
        loadFees()
        return
      }
      tab?.close()
      setPayError(json.error ?? 'We couldn’t open the invoice. Try again.')
      // A 409 means it's no longer due — paid in another tab, say.
      if (res.status === 409) loadFees()
    } catch {
      tab?.close()
      setPayError('Network error. Check your connection and try again.')
    } finally {
      setOpeningId(null)
    }
  }

  return (
    <AppShell title="Payments" description="Cancellation fees">
      <div className="px-5 py-5 pb-8 space-y-6 md:max-w-2xl md:mx-auto">

        {policyOn ? (
          <section>
            <p className="section-label mb-3">Cancellation policy</p>
            <div className="card px-4 py-4 space-y-2">
              <CancellationPolicy />
              <p className="text-xs" style={{ color: 'rgba(0,38,105,0.4)' }}>
                Days are counted at the course. A late cancellation is invoiced to whoever cancels the spot,
                and the invoice is due within 7 days.
              </p>
            </div>
          </section>
        ) : (
          fees.length === 0 && !loadingFees && (
            <p className="text-sm" style={{ color: 'rgba(0,38,105,0.5)' }}>
              There are no cancellation fees to show.
            </p>
          )
        )}

        {/* Shown whatever the policy's state — a fee invoiced while it was on
            is still owed, or still a receipt, if it's switched off later. */}
        {(loadingFees || fees.length > 0) && (
          <section>
            <p className="section-label mb-3">Cancellation fees</p>
            {loadingFees ? (
              <div className="flex justify-center py-6"><Spinner className="w-5 h-5" /></div>
            ) : (
              <div className="card">
                {fees.map((fee, i) => {
                  const meta = STATUS_META[fee.status] ?? STATUS_META.unpaid
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
                        {fee.invoice_pdf && (
                          <a
                            href={fee.invoice_pdf}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-block text-xs font-medium underline underline-offset-2 mt-1"
                            style={{ color: 'var(--color-green-700)' }}
                          >
                            Invoice {fee.invoice_number ?? ''} (PDF)
                          </a>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1 flex-shrink-0">
                        <span className="text-sm font-semibold" style={{ color: 'var(--color-green-900)' }}>
                          {formatRoundPrice(fee.amount)}
                        </span>
                        {owed(fee) && (policyOn || fee.invoice_url) ? (
                          <button
                            type="button"
                            onClick={() => openInvoice(fee)}
                            disabled={openingId !== null}
                            className="btn btn-primary btn-sm disabled:opacity-50"
                          >
                            {openingId === fee.id ? <Spinner className="w-3.5 h-3.5" /> : 'Pay invoice'}
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
