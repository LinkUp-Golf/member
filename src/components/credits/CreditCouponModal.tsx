'use client'

// Pay with credits: turn a balance into a code, then show the code.
//
// One modal for all three places credit gets spent — a tee time awaiting
// payment, a hosted round, and a plain conversion in the wallet — because they
// only differ in which bill sizes the amount. What the member sees is the same
// each time: what's owed, what their credit covers, and then the code to type at
// checkout.
//
// A code is money that has already left the wallet, so the screen after issuing
// leans on being able to actually use it: the code is large, copyable, and sits
// next to the link to the checkout it belongs to.

import { useCallback, useEffect, useState } from 'react'
import { Spinner } from '@/components/ui/Loading'
import type { CreditCoupon } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export type CouponModalTarget =
  | { kind: 'booking'; bookingId: string }
  | { kind: 'hosted_event'; hostedEventId: string }
  | { kind: 'general' }

interface Props {
  target: CouponModalTarget
  /** What is owed. Null for a wallet conversion, where the member picks. */
  price?: number | null
  balance: number
  /** The venue's checkout, offered once the code exists. */
  paymentUrl?: string | null
  /** Names the round in the copy — "your Aviara round on Friday". */
  roundLabel?: string | null
  /** A code the member already holds for this bill: skip straight to showing it. */
  existing?: CreditCoupon | null
  onClose: () => void
  /** Fired after a successful issue so the caller can refresh its own state. */
  onIssued?: (coupon: CreditCoupon) => void
}

export default function CreditCouponModal({
  target, price, balance, paymentUrl, roundLabel, existing, onClose, onIssued,
}: Props) {
  const [coupon, setCoupon] = useState<CreditCoupon | null>(existing ?? null)
  const [reused, setReused] = useState(!!existing)
  const [amount, setAmount] = useState(
    price != null ? String(Math.min(price, balance)) : ''
  )
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Escape closes it — this can appear over a full-screen booking flow, and a
  // modal you can't dismiss with the keyboard is a trap there.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // A code has to pay the round in full — a part-paying code fails at the
  // checkout — so a balance short of the price can't be used here at all. The
  // shortfall is what the member is told instead of being offered a code that
  // wouldn't work.
  const shortfall = price != null ? Math.max(0, price - balance) : 0
  const short = shortfall > 0
  const covers = price != null ? price : Number(amount) || 0

  // A code issued earlier for this round that the price has since outgrown —
  // possible when a venue's rate or a host's guest rate is edited afterwards.
  const heldShortfall = coupon && price != null
    ? Math.max(0, price - Number(coupon.amount))
    : 0

  const copy = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard is blocked in some in-app browsers; the code is on screen to
      // be read either way, so this is not worth an error message.
    }
  }, [])

  async function issue() {
    if (submitting) return
    setSubmitting(true)
    setError(null)

    const body: Record<string, unknown> = {}
    if (target.kind === 'booking') body.booking_id = target.bookingId
    if (target.kind === 'hosted_event') body.hosted_event_id = target.hostedEventId
    // A bill sets the amount server-side; only a wallet conversion sends one.
    if (target.kind === 'general') body.amount = Number(amount)

    const res = await fetch('/api/credits/coupons', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = await res.json().catch(() => ({}))
    setSubmitting(false)

    if (!res.ok) { setError(json.error ?? 'Could not create your credit code.'); return }
    setCoupon(json.coupon)
    setReused(!!json.existing)
    onIssued?.(json.coupon)
  }

  const field = 'w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-green-700 outline-none transition-colors bg-white'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6" role="dialog" aria-modal="true">
        {coupon ? (
          <>
            <h2 className="text-lg font-bold text-gray-900 mb-1">
              {reused ? 'Your credit code' : 'Code ready'}
            </h2>
            <p className="text-sm text-gray-500 mb-5">
              {reused
                ? 'You already have a code for this round — here it is again.'
                : `${fmtMoney(Number(coupon.amount))} of your credit is now a discount code.`}
            </p>

            {/* The code, at the size you can read off a phone while typing it
                into a checkout on a laptop. */}
            <button
              type="button"
              onClick={() => copy(coupon.code)}
              className="w-full rounded-xl border-2 border-dashed border-green-900/20 bg-green-50/50 px-4 py-4 text-center transition-colors hover:bg-green-50"
            >
              <span className="block font-mono text-xl font-bold tracking-widest text-green-950">
                {coupon.code}
              </span>
              <span className="block text-[11px] font-medium text-green-900/50 mt-1">
                {copied ? 'Copied' : 'Tap to copy'}
              </span>
            </button>

            <dl className="mt-4 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <dt className="text-gray-500">Worth</dt>
                <dd className="font-semibold text-gray-800">{fmtMoney(Number(coupon.amount))}</dd>
              </div>
              {/* Only legacy codes have a deadline — the ones issued back when
                  they lapsed after 30 days. Nothing new has one. */}
              {coupon.expires_at && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Use it by</dt>
                  <dd className="font-medium text-gray-700">{fmtDate(coupon.expires_at)}</dd>
                </div>
              )}
            </dl>

            {/* The round costs more than this code was issued for — a rate
                changed after the fact. It still works, it just won't clear the
                whole bill, and the member should hear that from us rather than
                at the till. */}
            {heldShortfall > 0 && (
              <div className="mt-4 rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
                <p className="text-sm font-medium text-amber-900">
                  This round now costs {fmtMoney(price ?? 0)}
                </p>
                <p className="text-xs text-amber-800/80 mt-1">
                  Your code covers {fmtMoney(Number(coupon.amount))} of it, leaving{' '}
                  {fmtMoney(heldShortfall)} to pay at checkout. To put more credit
                  toward it, refund this code from your Credits screen and create a
                  new one.
                </p>
              </div>
            )}

            <p className="text-xs text-gray-500 mt-4 leading-relaxed">
              Enter it in the coupon field at checkout. It works once and
              doesn&apos;t expire — if you change your mind, refund it from your
              Credits screen and the money goes back to your balance.
            </p>

            <div className="flex gap-3 mt-6">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Done
              </button>
              {paymentUrl && (
                <a
                  href={paymentUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1 py-2.5 rounded-xl bg-green-900 text-white text-sm font-semibold text-center hover:bg-green-800 transition-colors"
                >
                  Go to checkout →
                </a>
              )}
            </div>
          </>
        ) : (
          <>
            <h2 className="text-lg font-bold text-gray-900 mb-1">Pay with credits</h2>
            <p className="text-sm text-gray-500 mb-5">
              {price != null
                ? `Your credit becomes a discount code for ${roundLabel ?? 'this round'}.`
                : 'Turn part of your balance into a code you can use at any LinkUp checkout.'}
            </p>

            <dl className="space-y-2 text-sm">
              {price != null && (
                <div className="flex justify-between">
                  <dt className="text-gray-500">Amount due</dt>
                  <dd className="font-semibold text-gray-800">{fmtMoney(price)}</dd>
                </div>
              )}
              <div className="flex justify-between">
                <dt className="text-gray-500">Your balance</dt>
                <dd className="font-medium text-gray-700">{fmtMoney(balance)}</dd>
              </div>
            </dl>

            {price != null ? (
              short ? (
                /* Not enough to settle the round, so there is nothing to offer
                   — a code worth less than the bill would be refused at the
                   checkout. Say how much more is needed and leave the balance
                   alone. */
                <div className="mt-4 rounded-xl bg-amber-50 border border-amber-100 px-4 py-3">
                  <p className="text-sm font-medium text-amber-900">
                    {fmtMoney(shortfall)} short for this round
                  </p>
                  <p className="text-xs text-amber-800/80 mt-1">
                    A credit code has to cover the round in full, so this one has
                    to be paid at checkout. Your {fmtMoney(balance)} stays in your
                    balance for a round it can cover.
                  </p>
                </div>
              ) : (
                <div className="mt-4 rounded-xl bg-green-50 px-4 py-3">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-green-900">Credit applied</span>
                    <span className="font-bold text-green-950">{fmtMoney(covers)}</span>
                  </div>
                  <p className="text-xs text-green-900/70 mt-1.5">
                    Covers the round in full — nothing left to pay.
                  </p>
                </div>
              )
            ) : (
              <div className="mt-4">
                <label htmlFor="coupon-amount" className="block text-xs font-medium text-gray-600 mb-1">
                  Amount *
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                  <input
                    id="coupon-amount"
                    type="number"
                    min={0}
                    max={balance}
                    step="0.01"
                    className={`${field} pl-7`}
                    value={amount}
                    onChange={e => setAmount(e.target.value)}
                  />
                </div>
              </div>
            )}

            {error && <p className="text-sm text-red-500 mt-4">{error}</p>}

            <div className="flex gap-3 mt-6">
              <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                {short ? 'Close' : 'Cancel'}
              </button>
              {/* Nothing to press when the balance can't cover the round: an
                  offer that the server would refuse is worse than no offer.
                  Two things a spinner-in-a-button needs, neither of which this
                  one had: inline-flex, or the spinner (a block element) sits
                  against the left edge instead of centred; and a size matching
                  the label's line box — 20px for text-sm, 16px for the text-xs
                  .btn-sm — or the button resizes the moment the label is
                  swapped out. .btn does the centring already. */}
              {!short && (
                <button
                  onClick={issue}
                  disabled={submitting || covers <= 0 || covers > balance}
                  className="flex-1 inline-flex items-center justify-center py-2.5 rounded-xl bg-green-900 text-white text-sm font-semibold hover:bg-green-800 disabled:opacity-50 transition-colors"
                >
                  {submitting ? <Spinner className="w-5 h-5" /> : `Use ${fmtMoney(covers)}`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
