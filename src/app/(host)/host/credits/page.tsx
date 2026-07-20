'use client'

// Host credits: balance, earned/redeemed history, and redemption.

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader, StatCard, AdminCard, Badge } from '@/components/admin/AdminUI'
import { Spinner } from '@/components/ui/Loading'
import type { HostCreditEntry, HostCreditSummary, HostCreditKind } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const KIND_META: Record<HostCreditKind, { label: string; colour: 'green' | 'gray' | 'blue' }> = {
  earned:   { label: 'Earned',   colour: 'green' },
  redeemed: { label: 'Redeemed', colour: 'gray' },
  adjusted: { label: 'Adjusted', colour: 'blue' },
}

export default function HostCreditsPage() {
  const [summary, setSummary] = useState<HostCreditSummary | null>(null)
  const [entries, setEntries] = useState<HostCreditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [redeeming, setRedeeming] = useState(false)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500)
  }, [])

  const load = useCallback(async () => {
    const res = await fetch('/api/host/credits')
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      setError(null)
      setSummary(json.summary)
      setEntries(json.entries ?? [])
    } else {
      // Without this a failed load renders as a confident "$0.00 balance".
      setError(json.error ?? 'Could not load your credits.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const balance = summary?.balance ?? 0

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <AdminPageHeader
        title="Credits"
        description="Credits you've earned from hosting, and what you've redeemed."
        action={
          <button
            onClick={() => setRedeeming(true)}
            disabled={loading || balance <= 0}
            className="btn btn-gold btn-sm disabled:opacity-50"
          >
            Redeem credits
          </button>
        }
      />

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
      ) : error ? (
        <AdminCard>
          <div className="py-10 text-center">
            <p className="text-sm text-red-500">{error}</p>
            <button onClick={() => { setLoading(true); load() }} className="btn btn-outline btn-sm mt-4">Try again</button>
          </div>
        </AdminCard>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard label="Earned"    value={fmtMoney(summary?.earned ?? 0)}   sub="Approved" colour="green" />
            <StatCard label="Redeemed"  value={fmtMoney(summary?.redeemed ?? 0)} sub="Spent"    colour="gray" />
            <StatCard label="Available" value={fmtMoney(balance)}                sub="Balance"  colour="gold" large />
          </div>

          <AdminCard title="History">
            {entries.length === 0 ? (
              <p className="text-sm text-gray-400 italic py-6 text-center">
                No credit activity yet — credits appear here once an admin approves a completed event.
              </p>
            ) : (
              <div className="divide-y divide-gray-50">
                {entries.map(e => {
                  const meta = KIND_META[e.kind]
                  const positive = Number(e.amount) >= 0
                  return (
                    <div key={e.id} className="py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge label={meta.label} colour={meta.colour} />
                          <span className="text-xs text-gray-400">{fmtDate(e.created_at)}</span>
                        </div>
                        {e.note && <p className="text-xs text-gray-500 mt-1 truncate">{e.note}</p>}
                      </div>
                      <span className={`text-sm font-medium flex-shrink-0 ${positive ? 'text-green-700' : 'text-gray-500'}`}>
                        {positive ? '+' : '−'}{fmtMoney(Math.abs(Number(e.amount)))}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </AdminCard>
        </>
      )}

      {redeeming && summary && (
        <RedeemModal
          balance={balance}
          onClose={() => setRedeeming(false)}
          onRedeemed={(msg) => { setRedeeming(false); showToast(msg); load() }}
          onError={(msg) => showToast(msg, false)}
        />
      )}

      {toast && (
        <div className={`fixed top-6 right-6 z-[60] px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.ok ? 'bg-green-900 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function RedeemModal({ balance, onClose, onRedeemed, onError }: {
  balance: number
  onClose: () => void
  onRedeemed: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const field = 'w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-green-700 outline-none transition-colors bg-white'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  async function submit() {
    if (submitting) return
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt <= 0) { onError('Enter an amount greater than zero.'); return }
    if (amt > balance) { onError('That exceeds your available balance.'); return }
    setSubmitting(true)
    const res = await fetch('/api/host/credits/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amt, note: note.trim() || undefined }),
    })
    const json = await res.json().catch(() => ({}))
    setSubmitting(false)
    if (!res.ok) { onError(json.error ?? 'Could not redeem.'); return }
    onRedeemed('Credits redeemed.')
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-1">Redeem credits</h2>
        <p className="text-sm text-gray-500 mb-5">Available balance: {fmtMoney(balance)}</p>

        <div className="space-y-4">
          <div>
            <label htmlFor="redeem-amount" className={labelCls}>Amount *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
              <input id="redeem-amount" type="number" min={0} step="0.01" className={`${field} pl-7`} value={amount} onChange={e => setAmount(e.target.value)} />
            </div>
          </div>
          <div>
            <label htmlFor="redeem-note" className={labelCls}>Note</label>
            <input id="redeem-note" className={field} value={note} onChange={e => setNote(e.target.value)} placeholder="What you're redeeming for…" />
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">Cancel</button>
          <button onClick={submit} disabled={submitting || !amount} className="flex-1 py-2.5 rounded-xl bg-green-900 text-white text-sm font-semibold hover:bg-green-800 disabled:opacity-50 transition-colors">
            {submitting ? <Spinner className="w-4 h-4" /> : 'Redeem'}
          </button>
        </div>
      </div>
    </div>
  )
}
