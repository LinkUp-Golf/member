'use client'

import { useState, useEffect, useCallback } from 'react'
import { AdminPageHeader, AdminCard, Badge, StatCard } from '@/components/admin/AdminUI'
import { parseReferralLines } from '@/lib/referral-parse'
import type { ReferralPartnerSubmission, ReferralSubmissionEntry } from '@/types'

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const MAX_ENTRIES = 200

export default function PartnerSubmissionsPage() {
  const [submissions, setSubmissions] = useState<ReferralPartnerSubmission[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok })
    setTimeout(() => setToast(null), 4000)
  }

  const load = useCallback(async () => {
    const res = await fetch('/api/partner/submissions')
    const json = await res.json().catch(() => ({}))
    setSubmissions(Array.isArray(json.submissions) ? json.submissions : [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const hasPending = submissions.some(s => s.status === 'pending')
  const totalImported = submissions.reduce((sum, s) => sum + (s.imported_count ?? 0), 0)

  return (
    <div className="p-4 sm:p-8">
      <AdminPageHeader
        title="Submit Referrals"
        description="Send your referral list to the LinkUp team to be added to your account"
      />

      {toast && (
        <div className={`fixed top-6 right-6 z-[60] px-4 py-3 rounded-xl shadow-lg text-sm font-medium ${
          toast.ok ? 'bg-green-900 text-white' : 'bg-red-600 text-white'
        }`}>
          {toast.msg}
        </div>
      )}

      {!loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
          <StatCard label="Lists sent"    value={submissions.length} sub="All time"            colour="blue" />
          <StatCard label="Imported"      value={totalImported}      sub="Referrals added"     colour="green" />
          <StatCard label="Awaiting review" value={hasPending ? 1 : 0} sub="Pending lists"     colour="gold" />
        </div>
      )}

      {!loading && !hasPending && (
        <div className="mb-8">
          <SubmitForm
            onSubmitted={(msg) => { showToast(msg); load() }}
            onError={(msg) => showToast(msg, false)}
          />
        </div>
      )}

      {!loading && hasPending && (
        <div className="mb-8 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-700">
            You have a list awaiting review. Once the LinkUp team imports it you can submit another.
          </p>
        </div>
      )}

      <AdminCard title="Your Submissions">
        {loading ? (
          <p className="text-sm text-gray-400 py-4 text-center">Loading…</p>
        ) : submissions.length === 0 ? (
          <p className="text-sm text-gray-400 italic py-4 text-center">
            No lists submitted yet. Add the people you&apos;ve referred above.
          </p>
        ) : (
          <div className="divide-y divide-gray-50">
            {submissions.map(s => {
              const isOpen = expanded === s.id
              const entries = s.entries ?? []
              return (
                <div key={s.id} className="py-3">
                  <button
                    type="button"
                    onClick={() => setExpanded(isOpen ? null : s.id)}
                    className="w-full flex items-center justify-between gap-3 text-left"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-800">
                        {s.entry_count} referral{s.entry_count !== 1 ? 's' : ''} · {fmtDate(s.created_at)}
                      </p>
                      <p className="text-xs text-gray-400">
                        {s.status === 'imported'
                          ? `${s.imported_count ?? 0} added to your account`
                          : s.status === 'rejected'
                          ? (s.rejection_reason ?? 'Not imported')
                          : 'Awaiting review'}
                      </p>
                    </div>
                    <Badge
                      label={s.status === 'imported' ? 'Imported' : s.status === 'rejected' ? 'Not imported' : 'Pending'}
                      colour={s.status === 'imported' ? 'green' : s.status === 'rejected' ? 'red' : 'gold'}
                    />
                  </button>

                  {isOpen && entries.length > 0 && (
                    <div className="mt-3 ml-1 pl-3 border-l border-gray-100 space-y-2">
                      {entries.map((e: ReferralSubmissionEntry) => (
                        <div key={e.id} className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-xs text-gray-600 truncate">{e.name ?? e.email}</p>
                            {e.name && <p className="text-[11px] text-gray-400 truncate">{e.email}</p>}
                          </div>
                          <span className={`text-[11px] flex-shrink-0 text-right ${
                            e.status === 'imported' ? 'text-green-700' : e.status === 'skipped' ? 'text-gray-400' : 'text-gray-400'
                          }`}>
                            {e.status === 'imported' ? 'Added' : e.skip_reason ?? 'Pending'}
                          </span>
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
    </div>
  )
}

// ---- Submit form --------------------------------------------

function SubmitForm({
  onSubmitted,
  onError,
}: {
  onSubmitted: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const parsed = parseReferralLines(text)
  const tooMany = parsed.length > MAX_ENTRIES

  async function submit() {
    if (!parsed.length || tooMany || submitting) return
    setSubmitting(true)
    const res = await fetch('/api/partner/submissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: parsed, note: note.trim() || undefined }),
    })
    const json = await res.json().catch(() => ({}))
    setSubmitting(false)
    if (!res.ok) { onError(json.error ?? 'Could not submit your list.'); return }
    setText('')
    setNote('')
    onSubmitted(`Submitted ${parsed.length} referral${parsed.length !== 1 ? 's' : ''} for review.`)
  }

  const field = 'w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-green-700 outline-none transition-colors bg-white'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <AdminCard title="New Referral List">
      <div className="space-y-4">
        <div>
          <label htmlFor="referral-list" className={labelCls}>Referrals — one per line</label>
          <textarea
            id="referral-list"
            rows={8}
            className={`${field} resize-none font-mono text-xs`}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={'Jane Smith <jane@example.com>\nmark@example.com\nPriya Patel, priya@example.com'}
          />
          <p className="mt-1 text-[11px] text-gray-400">
            Paste names and email addresses. We&apos;ll pull out the email from each line — the rest is
            used as their name.
          </p>
        </div>

        {parsed.length > 0 && (
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
            <p className="text-xs font-medium text-gray-700 mb-2">
              {parsed.length} referral{parsed.length !== 1 ? 's' : ''} detected
              {tooMany && <span className="text-red-500"> — limit is {MAX_ENTRIES}</span>}
            </p>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {parsed.slice(0, 25).map(p => (
                <div key={p.email} className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="text-gray-600 truncate">{p.name ?? '—'}</span>
                  <span className="text-gray-400 truncate">{p.email}</span>
                </div>
              ))}
              {parsed.length > 25 && (
                <p className="text-[11px] text-gray-400 pt-1">…and {parsed.length - 25} more</p>
              )}
            </div>
          </div>
        )}

        <div>
          <label htmlFor="referral-note" className={labelCls}>Note for the team</label>
          <input
            id="referral-note"
            className={field}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Where you met them, anything useful…"
          />
        </div>

        <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
          <p className="text-[11px] text-gray-500">
            The LinkUp team reviews your list and adds each referral to your account. Anyone already
            attributed to another partner is skipped — you&apos;ll see the reason per person.
          </p>
        </div>

        <button
          type="button"
          onClick={submit}
          disabled={!parsed.length || tooMany || submitting}
          className="w-full py-2.5 rounded-xl bg-green-900 text-white text-sm font-semibold hover:bg-green-800 disabled:opacity-40 transition-colors"
        >
          {submitting
            ? 'Submitting…'
            : `Submit ${parsed.length || ''} referral${parsed.length !== 1 ? 's' : ''}`.replace('  ', ' ')}
        </button>
      </div>
    </AdminCard>
  )
}
