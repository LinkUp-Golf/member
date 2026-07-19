'use client'

// Referral lists submitted by a partner, reviewed on that partner's own admin
// page. Scoped to one partner deliberately: importing applies that partner's
// configured commission rate, so the decision belongs where the rate is
// visible and editable — not in a cross-partner queue where it isn't.
//
// Importing attributes each entry to this partner; anyone already claimed by a
// different partner is skipped with a reason rather than moved.

import { useState, useEffect, useCallback } from 'react'
import { Download, FileText } from 'lucide-react'
import { AdminCard, Badge } from '@/components/admin/AdminUI'
import { isRateExpired } from '@/lib/referral-rate'
import type { ReferralPartnerSubmission, ReferralSubmissionEntry } from '@/types'

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const STATUS = {
  pending:  { label: 'Pending',      colour: 'gold'  },
  imported: { label: 'Imported',     colour: 'green' },
  rejected: { label: 'Not imported', colour: 'red'   },
} as const

export default function ReferralSubmissions({
  partnerId,
  percentage,
  endsAt,
  onToast,
  onImported,
}: {
  partnerId: string
  /** The partner's configured rate — what an import will be taken on. */
  percentage: number
  endsAt: string | null
  onToast: (msg: string, ok?: boolean) => void
  /** Importing creates links, so the host page refreshes its stats. */
  onImported: () => void
}) {
  const [submissions, setSubmissions] = useState<ReferralPartnerSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState<ReferralPartnerSubmission | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/referral-submissions?partnerId=${partnerId}`)
    const json = await res.json().catch(() => ({}))
    setSubmissions(Array.isArray(json.submissions) ? json.submissions : [])
    setLoading(false)
  }, [partnerId])

  useEffect(() => { load() }, [load])

  const pending = submissions.filter(s => s.status === 'pending')

  return (
    <>
      <AdminCard
        title={`Submitted Referral Lists${pending.length ? ` (${pending.length} pending)` : ''}`}
      >
        {loading ? (
          <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
        ) : submissions.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-4 text-center">
            This partner hasn&apos;t submitted a referral list yet.
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {submissions.map(s => {
              const status = STATUS[s.status]
              return (
                <div key={s.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0 flex items-center gap-3">
                    <FileText className="w-4 h-4 text-gray-300 flex-shrink-0" strokeWidth={1.9} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {s.csv_filename ?? `${s.entry_count} referrals`}
                      </p>
                      <p className="text-xs text-gray-400">
                        {s.entry_count} row{s.entry_count !== 1 ? 's' : ''} · {fmtDate(s.created_at)}
                        {s.status === 'imported' && (
                          <> · {s.imported_count ?? 0} added
                            {s.applied_percentage !== null && ` at ${s.applied_percentage}%`}
                          </>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge label={status.label} colour={status.colour} />
                    <a
                      href={`/api/admin/referral-submissions/${s.id}/csv`}
                      className="text-xs font-medium text-gray-500 hover:text-green-800 px-2 py-1 inline-flex items-center gap-1"
                      title="Download the CSV as submitted"
                    >
                      <Download className="w-3.5 h-3.5" strokeWidth={2} />
                      CSV
                    </a>
                    <button
                      onClick={() => setReviewing(s)}
                      className="text-xs font-medium text-gray-500 hover:text-green-800 px-2 py-1"
                    >
                      {s.status === 'pending' ? 'Review' : 'View'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </AdminCard>

      {reviewing && (
        <SubmissionDrawer
          submission={reviewing}
          percentage={percentage}
          endsAt={endsAt}
          onClose={() => setReviewing(null)}
          onReviewed={(msg) => { setReviewing(null); onToast(msg); load(); onImported() }}
          onError={(msg) => onToast(msg, false)}
        />
      )}
    </>
  )
}

// ---- Review drawer ------------------------------------------

function SubmissionDrawer({ submission, percentage, endsAt, onClose, onReviewed, onError }: {
  submission: ReferralPartnerSubmission
  percentage: number
  endsAt: string | null
  onClose: () => void
  onReviewed: (msg: string) => void
  onError: (msg: string) => void
}) {
  const readOnly = submission.status !== 'pending'
  const entries = submission.entries ?? []
  const rateExpired = isRateExpired(endsAt)

  const [mode, setMode] = useState<'import' | 'reject'>('import')
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const field = 'w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-green-700 outline-none transition-colors bg-white'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  async function submit() {
    if (submitting) return
    if (mode === 'reject' && !reason.trim()) {
      onError('A reason is required so the partner knows why.')
      return
    }
    setSubmitting(true)
    const res = await fetch(`/api/admin/referral-submissions/${submission.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        mode === 'import' ? { action: 'import' } : { action: 'reject', rejection_reason: reason.trim() }
      ),
    })
    const json = await res.json().catch(() => ({}))
    setSubmitting(false)
    if (!res.ok) { onError(json.error ?? 'Review failed.'); return }

    onReviewed(mode === 'import'
      ? `Imported ${json.imported} of ${json.total} referral${json.total !== 1 ? 's' : ''}.`
      : 'List rejected.')
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-md h-full overflow-y-auto shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-5 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-lg font-bold text-gray-900">
            {readOnly ? 'Referral List' : 'Review Referral List'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">
                {submission.csv_filename ?? 'Referral list'}
              </p>
              <p className="text-xs text-gray-400">
                {submission.entry_count} referral{submission.entry_count !== 1 ? 's' : ''} ·
                submitted {fmtDate(submission.created_at)}
              </p>
            </div>
            <a
              href={`/api/admin/referral-submissions/${submission.id}/csv`}
              className="flex-shrink-0 inline-flex items-center gap-1.5 text-xs font-medium text-green-800 hover:underline"
            >
              <Download className="w-3.5 h-3.5" strokeWidth={2} />
              Download
            </a>
          </div>

          {submission.note && (
            <div>
              <p className={labelCls}>Note from the partner</p>
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl px-4 py-3">
                {submission.note}
              </p>
            </div>
          )}

          <div>
            <p className={labelCls}>Referrals</p>
            <div className="border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-72 overflow-y-auto">
              {entries.map((e: ReferralSubmissionEntry) => (
                <div key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-gray-700 truncate">{e.name ?? e.email}</p>
                    {e.name && <p className="text-[11px] text-gray-400 truncate">{e.email}</p>}
                  </div>
                  {e.status !== 'pending' && (
                    <span className={`text-[11px] flex-shrink-0 text-right ${
                      e.status === 'imported' ? 'text-green-700' : 'text-gray-400'
                    }`}>
                      {e.status === 'imported' ? 'Added' : e.skip_reason ?? 'Skipped'}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {readOnly ? (
            <div className="rounded-xl px-4 py-3 bg-gray-50 border border-gray-100">
              <p className="text-xs text-gray-500">
                {submission.status === 'imported'
                  ? `${submission.imported_count ?? 0} of ${submission.entry_count} referrals were added` +
                    (submission.applied_percentage !== null
                      ? ` at a ${submission.applied_percentage}% commission rate.`
                      : '.')
                  : `Rejected: ${submission.rejection_reason ?? 'no reason recorded'}`}
              </p>
            </div>
          ) : (
            <>
              <div className="flex gap-2 p-1 bg-gray-100 rounded-xl">
                {(['import', 'reject'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                      mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {m === 'import' ? 'Import' : 'Reject'}
                  </button>
                ))}
              </div>

              {mode === 'import' ? (
                <>
                  {/* The rate the import is taken on — stated here because it's
                      the term the partner will be paid under. */}
                  <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-gray-600">Commission rate applied</span>
                      <span className="text-sm font-semibold text-gray-900">{percentage}%</span>
                    </div>
                    {endsAt && (
                      <p className={`text-[11px] mt-1 ${rateExpired ? 'text-red-500' : 'text-gray-400'}`}>
                        Rate {rateExpired ? 'expired' : 'valid until'} {fmtDate(endsAt)}
                      </p>
                    )}
                  </div>

                  {rateExpired && (
                    <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
                      <p className="text-[11px] text-amber-700">
                        This partner&apos;s rate has expired, so referrals imported now earn no
                        commission when they convert. Extend the rate first if that isn&apos;t intended.
                      </p>
                    </div>
                  )}

                  <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
                    <p className="text-[11px] text-gray-500">
                      Each referral is attributed to this partner, and non-members are created as CRM
                      leads. Anyone already attributed to a different partner is skipped — you&apos;ll
                      see the per-person result afterwards.
                    </p>
                  </div>
                </>
              ) : (
                <div>
                  <label htmlFor="submission-reason" className={labelCls}>Reason *</label>
                  <textarea
                    id="submission-reason"
                    rows={4}
                    className={`${field} resize-none`}
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="Shared with the partner so they know what to fix."
                  />
                </div>
              )}

              <button
                type="button"
                onClick={submit}
                disabled={submitting}
                className={`w-full py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50 transition-colors ${
                  mode === 'import' ? 'bg-green-900 hover:bg-green-800' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {submitting
                  ? 'Working…'
                  : mode === 'import'
                  ? `Import ${entries.length} referral${entries.length !== 1 ? 's' : ''} at ${percentage}%`
                  : 'Reject list'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
