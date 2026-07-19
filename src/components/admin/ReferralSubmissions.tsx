'use client'

// Referral lists submitted by partners, rendered as a tab on the admin
// Referral Partners page. Importing a list attributes each entry to the
// submitting partner; anyone already claimed by a different partner is skipped
// with a reason rather than moved.

import { useState, useEffect, useCallback } from 'react'
import { AdminTable, AdminTr, AdminTd, StatCard, Badge } from '@/components/admin/AdminUI'
import type { ReferralPartnerSubmission, ReferralSubmissionEntry } from '@/types'

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const STATUS = {
  pending:  { label: 'Pending',      colour: 'gold'  },
  imported: { label: 'Imported',     colour: 'green' },
  rejected: { label: 'Not imported', colour: 'red'   },
} as const

export default function ReferralSubmissions({
  onToast,
  onImported,
}: {
  onToast: (msg: string, ok?: boolean) => void
  /** Importing creates links, so the host page refreshes its partner stats. */
  onImported: () => void
}) {
  const [submissions, setSubmissions] = useState<ReferralPartnerSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState<ReferralPartnerSubmission | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/referral-submissions')
    const json = await res.json().catch(() => ({}))
    if (!res.ok) onToast(json.error ?? 'Failed to load submissions.', false)
    setSubmissions(Array.isArray(json.submissions) ? json.submissions : [])
    setLoading(false)
    // onToast is recreated on each host render; depending on it would refetch
    // the list every time the parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load() }, [load])

  const counts = submissions.reduce(
    (acc, s) => ({ ...acc, [s.status]: (acc[s.status] ?? 0) + 1 }),
    {} as Record<string, number>
  )

  return (
    <>
      {!loading && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatCard label="Pending"  value={counts.pending  ?? 0} sub="Awaiting import" colour="gold" />
          <StatCard label="Imported" value={counts.imported ?? 0} sub="Lists processed" colour="green" />
          <StatCard label="Rejected" value={counts.rejected ?? 0} sub="Not imported"    colour="gray" />
        </div>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
      ) : (
        <AdminTable
          headers={['Partner', 'Submitted', 'Referrals', 'Status', '']}
          empty={submissions.length === 0 ? 'No referral lists submitted yet.' : undefined}
        >
          {submissions.map(s => {
            const status = STATUS[s.status]
            return (
              <AdminTr key={s.id}>
                <AdminTd className="font-medium text-gray-900">
                  <span className="block">{s.partner?.name ?? 'Unknown partner'}</span>
                  {s.partner?.code && (
                    <span className="block text-xs text-gray-400 font-normal">{s.partner.code}</span>
                  )}
                </AdminTd>
                <AdminTd>{fmtDate(s.created_at)}</AdminTd>
                <AdminTd>
                  {s.entry_count}
                  {s.status === 'imported' && (
                    <span className="text-gray-400 text-xs"> ({s.imported_count ?? 0} added)</span>
                  )}
                </AdminTd>
                <AdminTd><Badge label={status.label} colour={status.colour} /></AdminTd>
                <AdminTd className="text-right whitespace-nowrap">
                  <button
                    onClick={() => setReviewing(s)}
                    className="text-xs font-medium text-gray-500 hover:text-green-800 px-2 py-1"
                  >
                    {s.status === 'pending' ? 'Review' : 'View'}
                  </button>
                </AdminTd>
              </AdminTr>
            )
          })}
        </AdminTable>
      )}

      {reviewing && (
        <SubmissionDrawer
          submission={reviewing}
          onClose={() => setReviewing(null)}
          onReviewed={(msg) => { setReviewing(null); onToast(msg); load(); onImported() }}
          onError={(msg) => onToast(msg, false)}
        />
      )}
    </>
  )
}

// ---- Review drawer ------------------------------------------

function SubmissionDrawer({ submission, onClose, onReviewed, onError }: {
  submission: ReferralPartnerSubmission
  onClose: () => void
  onReviewed: (msg: string) => void
  onError: (msg: string) => void
}) {
  const readOnly = submission.status !== 'pending'
  const entries = submission.entries ?? []

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
          <div>
            <p className="text-sm font-semibold text-gray-900">{submission.partner?.name ?? 'Unknown partner'}</p>
            <p className="text-xs text-gray-400">
              {submission.entry_count} referral{submission.entry_count !== 1 ? 's' : ''} ·
              submitted {fmtDate(submission.created_at)}
            </p>
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
                  ? `${submission.imported_count ?? 0} of ${submission.entry_count} referrals were added to this partner.`
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
                <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
                  <p className="text-[11px] text-gray-500">
                    Each referral is attributed to this partner, and non-members are created as CRM leads.
                    Anyone already attributed to a different partner is skipped — you&apos;ll see the
                    per-person result afterwards.
                  </p>
                </div>
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
                  ? `Import ${entries.length} referral${entries.length !== 1 ? 's' : ''}`
                  : 'Reject list'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
