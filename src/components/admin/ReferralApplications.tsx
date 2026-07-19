'use client'

// Member applications for the referral-partner role. Rendered as a tab on the
// admin Referral Partners page rather than a page of its own — reviewing an
// application ends in creating a partner, so it belongs beside the partner
// list, not in a separate destination.

import { useState, useEffect, useCallback } from 'react'
import { AdminTable, AdminTr, AdminTd, StatCard, Badge } from '@/components/admin/AdminUI'
import { DEFAULT_REFERRAL_PERCENTAGE } from '@/lib/constants'
import type { ReferralPartnerApplication } from '@/types'

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function toSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

const STATUS_COLOURS = {
  pending:  'gold',
  approved: 'green',
  rejected: 'red',
} as const

export default function ReferralApplications({
  onToast,
  onReviewed,
}: {
  onToast: (msg: string, ok?: boolean) => void
  /** Approving creates a partner, so the host page refreshes its partner list. */
  onReviewed: () => void
}) {
  const [applications, setApplications] = useState<ReferralPartnerApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState<ReferralPartnerApplication | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/referral-partner-applications')
    const json = await res.json().catch(() => ({}))
    if (!res.ok) onToast(json.error ?? 'Failed to load applications.', false)
    setApplications(Array.isArray(json.applications) ? json.applications : [])
    setLoading(false)
    // onToast is recreated each render by the host; depending on it would
    // reload the list on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  const counts = applications.reduce(
    (acc, a) => ({ ...acc, [a.status]: (acc[a.status] ?? 0) + 1 }),
    {} as Record<string, number>
  )

  const memberName = (a: ReferralPartnerApplication) =>
    a.member ? `${a.member.first_name} ${a.member.last_name}`.trim() : 'Unknown member'

  return (
    <>
      {!loading && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatCard label="Pending"  value={counts.pending  ?? 0} sub="Awaiting review" colour="gold" />
          <StatCard label="Approved" value={counts.approved ?? 0} sub="Now partners"    colour="green" />
          <StatCard label="Rejected" value={counts.rejected ?? 0} sub="Not approved"    colour="gray" />
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
      ) : (
        <AdminTable
          headers={['Member', 'Applied', 'Status', 'Reviewed', '']}
          empty={applications.length === 0 ? 'No applications yet.' : undefined}
        >
          {applications.map(a => (
            <AdminTr key={a.id}>
              <AdminTd className="font-medium text-gray-900">
                <span className="block">{memberName(a)}</span>
                <span className="block text-xs text-gray-400 font-normal">{a.member?.email}</span>
              </AdminTd>
              <AdminTd>{fmtDate(a.created_at)}</AdminTd>
              <AdminTd>
                <Badge
                  label={a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                  colour={STATUS_COLOURS[a.status]}
                />
              </AdminTd>
              <AdminTd className="text-gray-400 text-xs">
                {a.reviewed_at ? fmtDate(a.reviewed_at) : '—'}
              </AdminTd>
              <AdminTd className="text-right whitespace-nowrap">
                <button
                  onClick={() => setReviewing(a)}
                  className="text-xs font-medium text-gray-500 hover:text-green-800 px-2 py-1"
                >
                  {a.status === 'pending' ? 'Review' : 'View'}
                </button>
              </AdminTd>
            </AdminTr>
          ))}
        </AdminTable>
      )}

      {reviewing && (
        <ReviewDrawer
          application={reviewing}
          memberName={memberName(reviewing)}
          onClose={() => setReviewing(null)}
          onReviewed={(msg) => { setReviewing(null); onToast(msg); load(); onReviewed() }}
          onError={(msg) => onToast(msg, false)}
        />
      )}
    </>
  )
}

// ---- Review drawer ------------------------------------------

function ReviewDrawer({ application, memberName, onClose, onReviewed, onError }: {
  application: ReferralPartnerApplication
  memberName: string
  onClose: () => void
  onReviewed: (msg: string) => void
  onError: (msg: string) => void
}) {
  const readOnly = application.status !== 'pending'

  const [percentage, setPercentage] = useState<number | ''>(DEFAULT_REFERRAL_PERCENTAGE)
  const [code, setCode] = useState(toSlug(memberName))
  const [endsAt, setEndsAt] = useState('')
  const [reason, setReason] = useState('')
  const [mode, setMode] = useState<'approve' | 'reject'>('approve')
  const [submitting, setSubmitting] = useState(false)

  const field = 'w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-green-700 outline-none transition-colors bg-white'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  async function submit() {
    if (submitting) return
    if (mode === 'reject' && !reason.trim()) {
      onError('A rejection reason is required.')
      return
    }
    setSubmitting(true)
    const res = await fetch(`/api/admin/referral-partner-applications/${application.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        mode === 'approve'
          ? { action: 'approve', code: code.trim(), percentage: Number(percentage), ends_at: endsAt || null }
          : { action: 'reject', rejection_reason: reason.trim() }
      ),
    })
    const json = await res.json().catch(() => ({}))
    setSubmitting(false)
    if (!res.ok) { onError(json.error ?? 'Review failed.'); return }
    onReviewed(mode === 'approve' ? `${memberName} is now a referral partner.` : 'Application rejected.')
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900">{readOnly ? 'Application' : 'Review Application'}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          <div>
            <p className="text-sm font-semibold text-gray-900">{memberName}</p>
            <p className="text-xs text-gray-400">{application.member?.email}</p>
          </div>

          <div>
            <p className={labelCls}>Why they want the role</p>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl px-4 py-3">
              {application.motivation}
            </p>
          </div>

          {readOnly ? (
            <div className="rounded-xl px-4 py-3 bg-gray-50 border border-gray-100">
              <p className="text-xs text-gray-500">
                {application.status === 'approved'
                  ? 'Approved — this member is now a referral partner.'
                  : `Rejected: ${application.rejection_reason ?? 'no reason recorded'}`}
              </p>
            </div>
          ) : (
            <>
              {/* Approve / reject toggle */}
              <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
                {(['approve', 'reject'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                      mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {m === 'approve' ? 'Approve' : 'Reject'}
                  </button>
                ))}
              </div>

              {mode === 'approve' ? (
                <>
                  <div>
                    <label htmlFor="review-code" className={labelCls}>Referral Code *</label>
                    <input
                      id="review-code"
                      className={field}
                      value={code}
                      onChange={e => setCode(e.target.value)}
                      placeholder="jane-smith"
                    />
                    <p className="mt-1 text-[11px] text-gray-400">
                      Lowercase letters, numbers, and hyphens. Must be unique.
                    </p>
                  </div>

                  <div>
                    <label htmlFor="review-pct" className={labelCls}>Commission Percentage *</label>
                    <div className="relative">
                      <input
                        id="review-pct"
                        type="number"
                        step="0.5"
                        min={0}
                        max={100}
                        className={`${field} pr-8 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                        value={percentage}
                        onChange={e => setPercentage(e.target.value === '' ? '' : Number(e.target.value))}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">%</span>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="review-ends" className={labelCls}>Rate Valid Until</label>
                    <input
                      id="review-ends"
                      type="date"
                      className={field}
                      value={endsAt}
                      onChange={e => setEndsAt(e.target.value)}
                    />
                    <p className="mt-1 text-[11px] text-gray-400">Leave blank for no expiry.</p>
                  </div>
                </>
              ) : (
                <div>
                  <label htmlFor="review-reason" className={labelCls}>Rejection Reason *</label>
                  <textarea
                    id="review-reason"
                    rows={4}
                    className={`${field} resize-none`}
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="Shared with the member in their notification."
                  />
                </div>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className={`w-full py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50 transition-colors ${
                  mode === 'approve' ? 'bg-green-900 hover:bg-green-800' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {submitting
                  ? 'Saving…'
                  : mode === 'approve' ? 'Approve & create partner' : 'Reject application'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
