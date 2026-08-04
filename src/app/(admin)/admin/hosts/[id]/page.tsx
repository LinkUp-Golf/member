'use client'

// Admin host detail: credit summary, ledger history, and a manual adjustment.

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { AdminPageHeader, StatCard, AdminCard, Badge } from '@/components/admin/AdminUI'
import type { CreditEntry, CreditSummary, CreditKind, CreditPurpose } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const KIND_META: Record<CreditKind, { label: string; colour: 'green' | 'gray' | 'blue' }> = {
  earned:   { label: 'Earned',   colour: 'green' },
  redeemed: { label: 'Redeemed', colour: 'gray' },
  adjusted: { label: 'Adjusted', colour: 'blue' },
}

const PURPOSE_LABEL: Record<CreditPurpose, string> = {
  golf:       'Toward golf',
  membership: 'Toward membership',
}

interface HostDetail {
  id: string
  name: string
  status: string
  member?: { first_name: string; last_name: string; email: string } | null
}

export default function AdminHostDetailPage() {
  const params = useParams()
  const id = String(params?.id ?? '')

  const [host, setHost] = useState<HostDetail | null>(null)
  const [summary, setSummary] = useState<CreditSummary | null>(null)
  const [entries, setEntries] = useState<CreditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500)
  }, [])

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/hosts/${id}/credits`)
    const json = await res.json().catch(() => ({}))
    if (res.ok) { setHost(json.host); setSummary(json.summary); setEntries(json.entries ?? []) }
    else showToast(json.error ?? 'Failed to load host.', false)
    setLoading(false)
  }, [id, showToast])

  useEffect(() => { if (id) load() }, [id, load])

  const memberName = host?.member ? `${host.member.first_name} ${host.member.last_name}`.trim() : ''

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <Link href="/admin/hosts" className="text-xs text-gray-400 hover:text-gray-600">← All hosts</Link>

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
      ) : !host ? (
        <div className="py-16 text-center text-sm text-red-500">Host not found.</div>
      ) : (
        <>
          <AdminPageHeader title={host.name} description={memberName ? `${memberName} · ${host.member?.email}` : host.member?.email} />

          <div className="grid grid-cols-3 gap-3 mb-6">
            <StatCard label="Earned"    value={fmtMoney(summary?.earned ?? 0)}   sub="Approved" colour="green" />
            <StatCard label="Redeemed"  value={fmtMoney(summary?.redeemed ?? 0)} sub="Spent"    colour="gray" />
            <StatCard label="Available" value={fmtMoney(summary?.balance ?? 0)}  sub="Balance"  colour="gold" large />
          </div>

          <AdjustCard hostId={id} onDone={(msg) => { showToast(msg); load() }} onError={(msg) => showToast(msg, false)} />

          <AdminCard title="Ledger">
            {entries.length === 0 ? (
              <p className="text-sm text-gray-400 italic py-6 text-center">No credit activity yet.</p>
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
                          {/* What a redemption is meant to buy — the admin has
                              to settle it, so it belongs on the row. */}
                          {e.purpose && (
                            <span className="text-xs font-medium text-gray-600">{PURPOSE_LABEL[e.purpose]}</span>
                          )}
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

      {toast && (
        <div className={`fixed top-6 right-6 z-[60] px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.ok ? 'bg-green-900 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function AdjustCard({ hostId, onDone, onError }: {
  hostId: string
  onDone: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submit() {
    if (submitting) return
    const amt = Number(amount)
    if (!Number.isFinite(amt) || amt === 0) { onError('Enter a non-zero amount (negative to deduct).'); return }
    setSubmitting(true)
    const res = await fetch(`/api/admin/hosts/${hostId}/credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amt, note: note.trim() || undefined }),
    })
    const json = await res.json().catch(() => ({}))
    setSubmitting(false)
    if (!res.ok) { onError(json.error ?? 'Could not adjust.'); return }
    setAmount(''); setNote('')
    onDone('Adjustment recorded.')
  }

  const field = 'w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-green-700 outline-none transition-colors bg-white'

  return (
    <AdminCard title="Manual adjustment">
      <p className="text-xs text-gray-500 mb-3">Add or deduct credit outside the normal earn/redeem flow. Use a negative amount to deduct.</p>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative sm:w-36">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
          <input type="number" step="0.01" className={`${field} pl-7`} placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} />
        </div>
        <input className={`${field} flex-1`} placeholder="Reason (recorded on the ledger)" value={note} onChange={e => setNote(e.target.value)} />
        <button onClick={submit} disabled={submitting || !amount} className="btn btn-sm bg-green-900 text-white disabled:opacity-50">
          {submitting ? 'Saving…' : 'Apply'}
        </button>
      </div>
    </AdminCard>
  )
}
