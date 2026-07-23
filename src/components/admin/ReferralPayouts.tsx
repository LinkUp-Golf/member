'use client'

// Recurring commission for one referral partner, on the admin partner detail
// page. Commission accrues monthly per referred member; a payout settles the
// outstanding balance once it clears the threshold. Payouts happen outside the
// app (cash or coupon) — this records them and shows the running balance.

import { useState, useEffect, useCallback } from 'react'
import { AdminCard, StatCard, Badge } from '@/components/admin/AdminUI'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

interface MemberAccrual {
  linkId: string
  email: string
  name: string | null
  startDate: string
  endDate: string | null
  months: number
  accrued: number
}

interface Payout {
  id: string
  amount: number
  method: string
  reference: string | null
  note: string | null
  paid_at: string
}

interface Balance {
  totalAccrued: number
  totalPaid: number
  outstanding: number
  payable: boolean
  threshold: number
}

interface PayoutsResponse {
  partner: { payout_method: 'cash' | 'coupon' }
  accruals: MemberAccrual[]
  payouts: Payout[]
  balance: Balance
  monthlyRate: number
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
  const [syncing, setSyncing] = useState(false)
  const [paying, setPaying] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/referral-partners/${partnerId}/payments`)
    const json = await res.json().catch(() => ({}))
    if (res.ok) setData(json)
    setLoading(false)
  }, [partnerId])

  useEffect(() => { load() }, [load])

  // Refresh membership from GHL, then reload. Recording a payout does this
  // automatically; this lets the admin see current numbers first.
  const syncFromGhl = useCallback(async () => {
    setSyncing(true)
    const res = await fetch(`/api/admin/referral-partners/${partnerId}/sync`, { method: 'POST' })
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      await load()
      onToast(`Synced ${json.refreshed ?? 0} member${json.refreshed === 1 ? '' : 's'} from GHL.`)
    } else {
      onToast(json.error ?? 'Sync failed.', false)
    }
    setSyncing(false)
  }, [partnerId, load, onToast])

  if (loading) return <AdminCard title="Commission & Payouts"><p className="text-sm text-gray-400 py-4 text-center">Loading…</p></AdminCard>
  if (!data) return <AdminCard title="Commission & Payouts"><p className="text-sm text-red-500 py-4 text-center">Could not load payouts.</p></AdminCard>

  const { balance, accruals, payouts, monthlyRate, partner } = data
  const toThreshold = Math.max(0, balance.threshold - balance.outstanding)

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-xs text-gray-400">
          {fmtMoney(monthlyRate)}/month per active member. Membership is verified from GHL on payout.
        </p>
        <button
          type="button"
          onClick={syncFromGhl}
          disabled={syncing}
          className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {syncing ? 'Syncing…' : 'Sync from GHL'}
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard label="Outstanding"  value={fmtMoney(Math.max(0, balance.outstanding))} sub="Unpaid balance"     colour="gold" />
        <StatCard label="Paid to date" value={fmtMoney(balance.totalPaid)}                sub="Across all payouts" colour="green" />
        <StatCard label="Earned"       value={fmtMoney(balance.totalAccrued)}             sub="All time"           colour="blue" />
      </div>

      <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
        <p className="text-xs text-gray-600">
          {balance.payable
            ? `Ready to pay out ${fmtMoney(balance.outstanding)}.`
            : `${fmtMoney(toThreshold)} below the ${fmtMoney(balance.threshold)} threshold — rolls over.`}
        </p>
        <button
          type="button"
          onClick={() => setPaying(true)}
          disabled={!balance.payable}
          className="flex-shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-green-900 text-white hover:bg-green-800 disabled:opacity-40 transition-colors"
        >
          Record payout
        </button>
      </div>

      <AdminCard title="Accrual by member">
        {accruals.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-4 text-center">
            No commission yet — accrual starts the month a referral becomes a paying member.
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {accruals.map(a => (
              <div key={a.linkId} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-700 truncate">{a.name ?? a.email}</p>
                  <p className="text-[11px] text-gray-400">
                    {a.months} month{a.months !== 1 ? 's' : ''} · since {fmtDate(a.startDate)}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <span className="text-sm font-medium text-gray-900">{fmtMoney(a.accrued)}</span>
                  <Badge label={a.endDate ? 'Ended' : 'Active'} colour={a.endDate ? 'gray' : 'green'} />
                </div>
              </div>
            ))}
          </div>
        )}
      </AdminCard>

      <div className="mt-4">
        <AdminCard title="Payout history">
          {payouts.length === 0 ? (
            <p className="text-sm text-gray-400 italic py-4 text-center">No payouts recorded yet.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {payouts.map(p => (
                <div key={p.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-800">{fmtDate(p.paid_at)}</p>
                    <p className="text-[11px] text-gray-400">
                      {p.method === 'coupon' ? 'Coupon' : 'Cash'}{p.reference ? ` · ${p.reference}` : ''}{p.note ? ` · ${p.note}` : ''}
                    </p>
                  </div>
                  <span className="text-sm font-medium text-gray-900 flex-shrink-0">{fmtMoney(p.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </AdminCard>
      </div>

      {paying && (
        <RecordPayoutModal
          partnerId={partnerId}
          outstanding={balance.outstanding}
          defaultMethod={partner.payout_method}
          onClose={() => setPaying(false)}
          onPaid={(msg) => { setPaying(false); onToast(msg); load() }}
          onError={(msg) => onToast(msg, false)}
        />
      )}
    </>
  )
}

// ---- Record payout modal ------------------------------------

function RecordPayoutModal({ partnerId, outstanding, defaultMethod, onClose, onPaid, onError }: {
  partnerId: string
  outstanding: number
  defaultMethod: 'cash' | 'coupon'
  onClose: () => void
  onPaid: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [amount, setAmount] = useState(outstanding.toFixed(2))
  const [method, setMethod] = useState<'cash' | 'coupon'>(defaultMethod)
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (submitting) return
    setSubmitting(true)
    const res = await fetch(`/api/admin/referral-partners/${partnerId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Number(amount),
        method,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
      }),
    })
    const json = await res.json().catch(() => ({}))
    setSubmitting(false)
    if (!res.ok) { onError(json.error ?? 'Could not record the payout.'); return }
    onPaid('Payout recorded.')
  }

  const field = 'w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-green-700 outline-none transition-colors bg-white'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-1">Record Payout</h2>
        <p className="text-sm text-gray-500 mb-5">Outstanding balance {fmtMoney(outstanding)}.</p>

        <div className="space-y-4">
          <div>
            <label htmlFor="payout-amount" className={labelCls}>Amount *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
              <input
                id="payout-amount"
                type="number"
                step="0.01"
                min={0}
                max={outstanding}
                className={`${field} pl-7`}
                value={amount}
                onChange={e => setAmount(e.target.value)}
              />
            </div>
          </div>

          <div>
            <span className={labelCls}>Method</span>
            <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
              {(['cash', 'coupon'] as const).map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMethod(m)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium capitalize transition-colors ${
                    method === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="payout-ref" className={labelCls}>
              {method === 'coupon' ? 'Coupon code' : 'Reference'}
            </label>
            <input
              id="payout-ref"
              className={field}
              value={reference}
              onChange={e => setReference(e.target.value)}
              placeholder={method === 'coupon' ? 'Coupon code issued' : 'Bank transfer ref'}
            />
          </div>

          <div>
            <label htmlFor="payout-note" className={labelCls}>Note</label>
            <input
              id="payout-note"
              className={field}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
            <p className="text-[11px] text-gray-500">
              Records a payout made outside the app and notifies the partner. Settles the balance up to the amount entered.
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
            disabled={submitting || !amount || Number(amount) <= 0}
            className="flex-1 py-2.5 rounded-xl bg-green-900 text-white text-sm font-semibold hover:bg-green-800 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Saving…' : 'Record payout'}
          </button>
        </div>
      </div>
    </div>
  )
}
