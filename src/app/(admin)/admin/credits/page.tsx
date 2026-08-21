'use client'

// Credit codes — the admin side of members paying with credit.
//
// A code is credit that has already left a member's wallet, so the number that
// matters here is what's outstanding: issued, not yet used, and therefore money
// LinkUp still owes a round against. Beside it, what's actually been spent at a
// checkout and what came back unused.
//
// The bookings screen answers "was this round paid with credit" for one round;
// this answers it across the board, including codes not tied to a booking at
// all, and is where a code can be pulled back when a member asks.

import { useCallback, useEffect, useState } from 'react'
import { AdminPageHeader, StatCard, AdminCard, Badge } from '@/components/admin/AdminUI'
import { ContentLoader, Spinner } from '@/components/ui/Loading'
import Select from '@/components/ui/Select'
import { isCouponUsable } from '@/lib/credits'
import type { CreditCoupon, CreditCouponStatus } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const STATUS_META: Record<CreditCouponStatus, { label: string; colour: 'green' | 'gold' | 'gray' | 'red' }> = {
  issued:   { label: 'Outstanding', colour: 'gold' },
  redeemed: { label: 'Used',        colour: 'green' },
  void:     { label: 'Returned',    colour: 'gray' },
  expired:  { label: 'Expired',     colour: 'gray' },
}

const STATUS_FILTERS = ['all', 'issued', 'redeemed', 'void', 'expired'] as const
type StatusFilter = typeof STATUS_FILTERS[number]

// What the code was issued against, in the words an admin would use.
const against = (c: CreditCoupon) =>
  c.booking_id ? 'Tee time' : c.hosted_event_id ? 'Hosted round' : 'Wallet'

const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all: 'All codes',
  issued: 'Outstanding',
  redeemed: 'Used',
  void: 'Returned',
  expired: 'Expired',
}

interface Totals {
  count: number
  outstanding: number
  outstandingCount: number
  redeemed: number
  redeemedCount: number
  refunded: number
}

export default function AdminCreditCodesPage() {
  const [coupons, setCoupons] = useState<CreditCoupon[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [status, setStatus] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voidingId, setVoidingId] = useState<string | null>(null)
  const [confirmVoid, setConfirmVoid] = useState<CreditCoupon | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350)
    return () => clearTimeout(t)
  }, [search])

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500)
  }, [])

  // `sync` is opt-in: reconciling against GHL is one request per outstanding
  // code, so it belongs behind a button rather than on every filter change.
  const load = useCallback(async (sync = false) => {
    const params = new URLSearchParams()
    if (status !== 'all') params.set('status', status)
    if (debouncedSearch) params.set('q', debouncedSearch)
    if (sync) params.set('sync', '1')

    const res = await fetch(`/api/admin/credit-coupons?${params}`)
    const json = await res.json().catch(() => ({}))
    if (res.ok) {
      setError(null)
      setCoupons(json.coupons ?? [])
      setTotals(json.totals ?? null)
    } else {
      setError(json.error ?? 'Could not load credit codes.')
    }
    setLoading(false)
    setSyncing(false)
  }, [status, debouncedSearch])

  useEffect(() => { load() }, [load])

  async function voidCode(coupon: CreditCoupon) {
    if (voidingId) return
    setVoidingId(coupon.id)
    const res = await fetch(`/api/admin/credit-coupons/${coupon.id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'Cancelled by an admin' }),
    })
    const json = await res.json().catch(() => ({}))
    setVoidingId(null)
    setConfirmVoid(null)
    if (!res.ok) {
      showToast(json.error ?? 'Could not cancel that code.', false)
      // Same as the member wallet: discovering a code was already used settles
      // it as redeemed, so the list needs re-reading even on a refusal.
      load()
      return
    }
    showToast(`${fmtMoney(Number(coupon.amount))} returned to the member's balance.`)
    load()
  }

  const memberName = (c: CreditCoupon) =>
    c.member ? `${c.member.first_name} ${c.member.last_name}`.trim() : 'Member'

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <AdminPageHeader
        title="Credit Codes"
        description="Credit members have turned into coupon codes, and what's become of each one."
        action={
          <button
            onClick={() => { setSyncing(true); load(true) }}
            disabled={syncing || loading}
            className="btn btn-outline btn-sm disabled:opacity-50"
          >
            {syncing ? <Spinner className="w-4 h-4" /> : 'Refresh from GHL'}
          </button>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <StatCard
          label="Outstanding"
          value={fmtMoney(totals?.outstanding ?? 0)}
          sub={`${totals?.outstandingCount ?? 0} code${(totals?.outstandingCount ?? 0) === 1 ? '' : 's'} not yet used`}
          colour="gold"
        />
        <StatCard
          label="Used"
          value={fmtMoney(totals?.redeemed ?? 0)}
          sub={`${totals?.redeemedCount ?? 0} settled at checkout`}
          colour="green"
        />
        <div className="col-span-2 sm:col-span-1">
          <StatCard
            label="Returned"
            value={fmtMoney(totals?.refunded ?? 0)}
            sub="Cancelled or expired unused"
            colour="gray"
          />
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <Select
          value={status}
          onChange={v => { setLoading(true); setStatus(v as StatusFilter) }}
          options={STATUS_FILTERS.map(s => ({ value: s, label: STATUS_FILTER_LABELS[s] }))}
          placeholder="All codes"
          className="sm:w-56"
          triggerClassName="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg flex items-center justify-between gap-2 bg-white"
        />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search a code…"
          aria-label="Search a code"
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-900/20"
        />
      </div>

      {loading ? (
        <ContentLoader />
      ) : error ? (
        <AdminCard>
          <div className="py-10 text-center">
            <p className="text-sm text-red-500">{error}</p>
            <button onClick={() => { setLoading(true); load() }} className="btn btn-outline btn-sm mt-4">Try again</button>
          </div>
        </AdminCard>
      ) : (
        <AdminCard title={`${coupons.length} code${coupons.length === 1 ? '' : 's'}`}>
          {coupons.length === 0 ? (
            <p className="text-sm text-gray-400 italic py-8 text-center">
              No credit codes match that.
            </p>
          ) : (
            <div className="divide-y divide-gray-50">
              {coupons.map(c => {
                const meta = STATUS_META[c.status]
                return (
                  <div key={c.id} className="py-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-semibold text-gray-900">{c.code}</span>
                        <Badge label={meta.label} colour={meta.colour} />
                        <span className="text-sm font-semibold text-gray-700">{fmtMoney(Number(c.amount))}</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1 truncate">
                        {memberName(c)}
                        {c.member?.email ? ` · ${c.member.email}` : ''}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5 truncate">
                        {against(c)}
                        {c.course?.name ? ` · ${c.course.name}` : ''}
                        {' · issued '}{fmtDate(c.created_at)}
                        {/* An outstanding code has no end date to report
                            unless it's a legacy row that carries one. */}
                        {c.status === 'issued'
                          ? c.expires_at ? ` · expires ${fmtDate(c.expires_at)}` : ''
                          : c.settled_at ? ` · ${meta.label.toLowerCase()} ${fmtDate(c.settled_at)}` : ''}
                      </p>
                      {/* A code with no GHL id behind it never made it to the
                          payment provider — the credit was refunded, but say so
                          rather than leaving an unexplained void row. */}
                      {!c.ghl_coupon_id && c.status !== 'issued' && (
                        <p className="text-xs text-amber-700 mt-0.5">Never reached GHL — credit was returned.</p>
                      )}
                    </div>
                    {isCouponUsable(c) && (
                      <button
                        onClick={() => setConfirmVoid(c)}
                        disabled={voidingId === c.id}
                        className="btn btn-outline btn-sm flex-shrink-0 text-red-600 border-red-200 disabled:opacity-50"
                      >
                        {voidingId === c.id ? <Spinner className="w-4 h-4" /> : 'Cancel & refund'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </AdminCard>
      )}

      {confirmVoid && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={() => setConfirmVoid(null)} />
          <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-1">Cancel this code?</h2>
            <p className="text-sm text-gray-500 mb-5">
              {confirmVoid.code} stops working and {fmtMoney(Number(confirmVoid.amount))} goes
              back to {memberName(confirmVoid)}&apos;s balance. Do this only if the code
              hasn&apos;t been used — a used code can&apos;t be undone here.
            </p>
            <div className="flex gap-3">
              <button onClick={() => setConfirmVoid(null)} className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Keep it
              </button>
              <button
                onClick={() => voidCode(confirmVoid)}
                disabled={voidingId === confirmVoid.id}
                className="flex-1 inline-flex items-center justify-center py-2.5 rounded-xl bg-red-600 text-white text-sm font-semibold hover:bg-red-700 disabled:opacity-50"
              >
                {voidingId === confirmVoid.id ? <Spinner className="w-5 h-5" /> : 'Cancel & refund'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className={`fixed top-6 right-6 z-[60] px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.ok ? 'bg-green-900 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
