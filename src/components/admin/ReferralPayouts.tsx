'use client'

// Monthly commission payouts for one referral partner, rendered on the admin
// partner detail page. Commission is settled manually outside the app, so this
// is a ledger: it shows what each month earned and lets an admin record that a
// month has been paid.

import { useState, useEffect, useCallback } from 'react'
import { AdminCard, StatCard, Badge } from '@/components/admin/AdminUI'
import { formatPeriod } from '@/lib/referral-rate'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

interface Conversion {
  linkId: string
  email: string
  name: string | null
  convertedAt: string
  commission: number
}

interface PayoutPeriod {
  periodMonth: string
  conversions: Conversion[]
  total: number
  paid: boolean
  paidAmount: number | null
  paidAt: string | null
}

interface PayoutsResponse {
  periods: PayoutPeriod[]
  totalPaid: number
  totalOutstanding: number
}

export default function ReferralPayouts({
  partnerId,
  onToast,
}: {
  partnerId: string
  onToast: (msg: string, ok?: boolean) => void
}) {
  const [data, setData] = useState<PayoutsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [paying, setPaying] = useState<PayoutPeriod | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/referral-partners/${partnerId}/payments`)
    const json = await res.json().catch(() => ({}))
    if (res.ok) setData(json)
    setLoading(false)
  }, [partnerId])

  useEffect(() => { load() }, [load])

  if (loading) return <AdminCard title="Commission & Payments"><p className="text-sm text-gray-400 py-4 text-center">Loading…</p></AdminCard>
  if (!data) return <AdminCard title="Commission & Payments"><p className="text-sm text-red-500 py-4 text-center">Could not load payouts.</p></AdminCard>

  const { periods, totalPaid, totalOutstanding } = data

  return (
    <>
      <div className="grid grid-cols-2 gap-3 mb-4">
        <StatCard label="Paid to date" value={fmtMoney(totalPaid)}        sub="Across all months" colour="green" />
        <StatCard label="Outstanding"  value={fmtMoney(totalOutstanding)} sub="Awaiting payout"   colour="gold" />
      </div>

      <AdminCard title="Commission & Payments">
        {periods.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-4 text-center">
            No commission earned yet — a month appears here once a referral becomes a paying member.
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {periods.map(p => {
              const isOpen = expanded === p.periodMonth
              return (
                <div key={p.periodMonth} className="py-3">
                  <div className="flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen ? null : p.periodMonth)}
                      className="min-w-0 text-left flex-1"
                    >
                      <p className="text-sm font-medium text-gray-800">{formatPeriod(p.periodMonth)}</p>
                      <p className="text-xs text-gray-400">
                        {p.conversions.length} conversion{p.conversions.length !== 1 ? 's' : ''}
                        {p.paid && p.paidAt ? ` · paid ${fmtDate(p.paidAt)}` : ''}
                      </p>
                    </button>

                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-sm font-medium text-gray-900">
                        {fmtMoney(p.paid && p.paidAmount !== null ? p.paidAmount : p.total)}
                      </span>
                      {p.paid ? (
                        <Badge label="Paid" colour="green" />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPaying(p)}
                          className="text-xs font-medium px-2.5 py-1 rounded-lg bg-green-900 text-white hover:bg-green-800 transition-colors"
                        >
                          Record payment
                        </button>
                      )}
                    </div>
                  </div>

                  {isOpen && p.conversions.length > 0 && (
                    <div className="mt-3 ml-1 pl-3 border-l border-gray-100 space-y-2">
                      {p.conversions.map(c => (
                        <div key={c.linkId} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs text-gray-600 truncate">{c.name ?? c.email}</p>
                            <p className="text-[11px] text-gray-400">Joined {fmtDate(c.convertedAt)}</p>
                          </div>
                          <span className="text-xs text-gray-500 flex-shrink-0">{fmtMoney(c.commission)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </AdminCard>

      {paying && (
        <RecordPaymentModal
          partnerId={partnerId}
          period={paying}
          onClose={() => setPaying(null)}
          onPaid={(msg) => { setPaying(null); onToast(msg); load() }}
          onError={(msg) => onToast(msg, false)}
        />
      )}
    </>
  )
}

// ---- Record payment modal -----------------------------------

function RecordPaymentModal({ partnerId, period, onClose, onPaid, onError }: {
  partnerId: string
  period: PayoutPeriod
  onClose: () => void
  onPaid: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [amount, setAmount] = useState(period.total.toFixed(2))
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const adjusted = Number(amount) !== period.total

  async function submit() {
    if (submitting) return
    setSubmitting(true)
    const res = await fetch(`/api/admin/referral-partners/${partnerId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        period_month: period.periodMonth.slice(0, 7),
        amount: Number(amount),
        note: note.trim() || undefined,
      }),
    })
    const json = await res.json().catch(() => ({}))
    setSubmitting(false)
    if (!res.ok) { onError(json.error ?? 'Could not record the payment.'); return }
    onPaid(`${formatPeriod(period.periodMonth)} marked as paid.`)
  }

  const field = 'w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-green-700 outline-none transition-colors bg-white'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-1">Record Payment</h2>
        <p className="text-sm text-gray-500 mb-5">
          {formatPeriod(period.periodMonth)} · {period.conversions.length} conversion
          {period.conversions.length !== 1 ? 's' : ''} · calculated {fmtMoney(period.total)}
        </p>

        <div className="space-y-4">
          <div>
            <label htmlFor="payment-amount" className={labelCls}>Amount Paid *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
              <input
                id="payment-amount"
                type="number"
                step="0.01"
                min={0}
                className={`${field} pl-7`}
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </div>
            {adjusted && (
              <p className="mt-1 text-[11px] text-amber-600">
                Differs from the calculated {fmtMoney(period.total)} — the original figure is kept on the record.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="payment-note" className={labelCls}>Note</label>
            <input
              id="payment-note"
              className={field}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Bank transfer ref, adjustment reason…"
            />
          </div>

          <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
            <p className="text-[11px] text-gray-500">
              This records a payment made outside the app and notifies the partner. A month can only be
              paid once.
            </p>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !amount}
            className="flex-1 py-2.5 rounded-xl bg-green-900 text-white text-sm font-semibold hover:bg-green-800 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Saving…' : 'Mark as paid'}
          </button>
        </div>
      </div>
    </div>
  )
}
