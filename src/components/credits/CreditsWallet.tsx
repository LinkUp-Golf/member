'use client'

// The member credit wallet: balance, history, and the codes credit turns into.
//
// One component for both workspaces. The wallet belongs to the member, not to
// their host or partner row, so a user who both hosts and refers sees one
// balance whichever workspace they're standing in — only the API prefix and the
// "where credit comes from" copy differ.
//
// Spending requires an active membership: a host or partner who isn't a member
// still earns, and still sees their balance, but spends nothing until they join.
// canRedeem comes from the API so a disabled button can say why.
//
// Spending means getting a code. Credit becomes a fixed-amount GHL coupon the
// member enters at a venue's checkout — which is why this screen shows codes
// next to the balance: an issued code is money already out of the wallet and
// waiting to be used. Redemption used to be a request an admin settled by hand,
// and the ledger still holds those rows; 'membership' purposes date from further
// back still, which is why the label map keeps both.

import { useCallback, useEffect, useState } from 'react'
import { AdminPageHeader, StatCard, AdminCard, Badge } from '@/components/admin/AdminUI'
import { Spinner, ContentLoader } from '@/components/ui/Loading'
import CreditCouponModal from '@/components/credits/CreditCouponModal'
import { MEMBERSHIP_CHECKOUT_URL, MEMBERSHIP_JOIN_URL } from '@/lib/constants'
import { isCouponUsable } from '@/lib/credits'
import type {
  CreditEntry, CreditSummary, CreditKind, CreditPurpose,
  CreditCoupon, CreditCouponStatus,
} from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const KIND_META: Record<CreditKind, { label: string; colour: 'green' | 'gray' | 'blue' }> = {
  earned:   { label: 'Earned',   colour: 'green' },
  redeemed: { label: 'Redeemed', colour: 'gray' },
  adjusted: { label: 'Adjusted', colour: 'blue' },
}

// Historical rows only — nothing new is written against 'membership'.
const PURPOSE_LABEL: Record<CreditPurpose, string> = {
  golf:       'Toward golf',
  membership: 'Toward membership',
}

const COUPON_META: Record<CreditCouponStatus, { label: string; colour: 'green' | 'gold' | 'gray' }> = {
  issued:   { label: 'Ready to use', colour: 'gold' },
  redeemed: { label: 'Used',         colour: 'green' },
  void:     { label: 'Returned',     colour: 'gray' },
  expired:  { label: 'Expired',      colour: 'gray' },
}

interface Props {
  /** API prefix for this workspace — '/api/host' or '/api/partner'. */
  basePath: string
  /** How credit is earned here, appended to the shared spending copy. */
  earnedHint: string
}

export default function CreditsWallet({ basePath, earnedHint }: Props) {
  const [summary, setSummary] = useState<CreditSummary | null>(null)
  const [entries, setEntries] = useState<CreditEntry[]>([])
  const [coupons, setCoupons] = useState<CreditCoupon[]>([])
  // Assume no until the API says otherwise — a load failure shouldn't open a
  // form the server is going to refuse.
  const [canRedeem, setCanRedeem] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [issuing, setIssuing] = useState(false)
  const [refundingId, setRefundingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  const showToast = useCallback((msg: string, ok = true) => {
    setToast({ msg, ok }); setTimeout(() => setToast(null), 3500)
  }, [])

  const load = useCallback(async () => {
    // Two calls: the ledger side is workspace-scoped, the codes are the
    // member's wherever they're standing. ?sync=1 because this is the screen
    // where a code's state actually matters, so it's worth the GHL round-trip
    // to catch one that's been used or has lapsed.
    const [walletRes, couponRes] = await Promise.all([
      fetch(`${basePath}/credits`),
      fetch('/api/credits/coupons?sync=1'),
    ])
    const wallet = await walletRes.json().catch(() => ({}))

    if (walletRes.ok) {
      setError(null)
      setSummary(wallet.summary)
      setEntries(wallet.entries ?? [])
      setCanRedeem(wallet.canRedeem === true)
    } else {
      // Without this a failed load renders as a confident "$0.00 balance".
      setError(wallet.error ?? 'Could not load your credits.')
    }

    if (couponRes.ok) {
      const json = await couponRes.json().catch(() => ({}))
      setCoupons(json.coupons ?? [])
      // A code returned or expired since the ledger was read moves the balance,
      // so prefer the fresher figure when both calls succeeded.
      if (walletRes.ok && json.summary) setSummary(json.summary)
    }

    setLoading(false)
  }, [basePath])

  useEffect(() => { load() }, [load])

  const balance = summary?.balance ?? 0

  async function refund(coupon: CreditCoupon) {
    if (refundingId) return
    setRefundingId(coupon.id)
    const res = await fetch(`/api/credits/coupons/${coupon.id}`, { method: 'DELETE' })
    const json = await res.json().catch(() => ({}))
    setRefundingId(null)
    if (!res.ok) {
      showToast(json.error ?? 'Could not refund that code.', false)
      // A refusal isn't always a no-op: a code we discover has already been used
      // gets settled as redeemed. Re-read so the row stops offering a refund.
      load()
      return
    }
    showToast(`${fmtMoney(Number(coupon.amount))} is back in your balance.`)
    load()
  }

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <AdminPageHeader
        title="Credits"
        description="What you've earned, and the codes it turns into. Spend them on golf."
        action={
          <button
            onClick={() => setIssuing(true)}
            disabled={loading || balance <= 0 || !canRedeem}
            className="btn btn-gold btn-sm disabled:opacity-50"
          >
            Get a credit code
          </button>
        }
      />

      {/* Say it before the balance, not after they've tried to spend it. Only
          once the wallet has actually loaded — mid-load this would flash for
          everyone, members included. */}
      {!loading && !error && !canRedeem && (
        <div className="rounded-xl bg-amber-50 border border-amber-100 px-4 py-3 mb-6">
          <p className="text-sm font-medium text-amber-900">
            Spending needs a LinkUp membership
          </p>
          <p className="text-xs text-amber-800/80 mt-1">
            Keep earning — your balance is yours and it keeps building. You can
            spend it on golf once you&apos;ve joined.
          </p>
          {/* Two doors: ready to pay, or wants to read first. Telling someone
              what they can't do without showing them the way out is the part
              that reads as a dead end. External marketing site, so new tab —
              this is a PWA and navigating away loses their place. */}
          <div className="flex flex-wrap items-center gap-2 mt-3">
            <a
              href={MEMBERSHIP_CHECKOUT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-sm bg-amber-900 text-white hover:bg-amber-800"
            >
              Get a membership
            </a>
            <a
              href={MEMBERSHIP_JOIN_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-amber-900 hover:underline px-1"
            >
              How joining works ↗
            </a>
          </div>
        </div>
      )}

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
        <>
          {/* Three across only has room from sm up. On a phone a third of the
              width can't hold a formatted amount at this type size, so Available
              — the largest figure and the biggest text — takes its own row. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
            <StatCard label="Earned"    value={fmtMoney(summary?.earned ?? 0)}   sub="Approved" colour="green" />
            <StatCard label="Redeemed"  value={fmtMoney(summary?.redeemed ?? 0)} sub="Spent"    colour="gray" />
            <div className="col-span-2 sm:col-span-1">
              <StatCard label="Available" value={fmtMoney(balance)} sub="Balance" colour="gold" large />
            </div>
          </div>

          {coupons.length > 0 && (
            <div className="mb-6">
              <AdminCard title="Credit codes">
                <div className="divide-y divide-gray-50">
                  {coupons.map(c => {
                    const meta = COUPON_META[c.status]
                    const usable = isCouponUsable(c)
                    return (
                      <div key={c.id} className="py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm font-semibold text-gray-900">{c.code}</span>
                            <Badge label={meta.label} colour={meta.colour} />
                          </div>
                          <p className="text-xs text-gray-400 mt-1 truncate">
                            {fmtMoney(Number(c.amount))}
                            {c.course?.name ? ` · ${c.course.name}` : ''}
                            {' · '}
                            {/* Codes don't expire, so an open one is described
                                by when it was issued. A stored deadline only
                                exists on legacy rows. */}
                            {c.status === 'issued'
                              ? c.expires_at
                                ? `use by ${fmtDate(c.expires_at)}`
                                : `issued ${fmtDate(c.created_at)}`
                              : c.settled_at
                                ? fmtDate(c.settled_at)
                                : fmtDate(c.created_at)}
                          </p>
                        </div>
                        {/* An unused code can be refunded — the credit
                            returns to the balance, which is the only way to
                            undo a code issued by mistake. */}
                        {usable && (
                          <button
                            onClick={() => refund(c)}
                            disabled={refundingId === c.id}
                            className="btn btn-outline btn-sm flex-shrink-0 disabled:opacity-50"
                          >
                            {refundingId === c.id ? <Spinner className="w-4 h-4" /> : 'Refund'}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </AdminCard>
            </div>
          )}

          <AdminCard title="History">
            {entries.length === 0 ? (
              <p className="text-sm text-gray-400 italic py-6 text-center">
                No credit activity yet — {earnedHint}
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

      {/* No bill to size against here, so the member says how much — unlike the
          Book screen and a hosted round, which know what's owed. */}
      {issuing && canRedeem && (
        <CreditCouponModal
          target={{ kind: 'general' }}
          balance={balance}
          onIssued={() => { showToast('Your credit code is ready.'); load() }}
          onClose={() => setIssuing(false)}
        />
      )}

      {toast && (
        <div className={`fixed top-6 right-6 z-[80] px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${toast.ok ? 'bg-green-900 text-white' : 'bg-red-600 text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
