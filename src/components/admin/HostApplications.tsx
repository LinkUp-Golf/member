'use client'

// Member applications for the host role. Rendered as a tab on the admin Hosts
// page — reviewing an application ends in creating a host, so it belongs beside
// the host list rather than in a separate destination.

import { useState, useEffect, useCallback } from 'react'
import { AdminTable, AdminTr, AdminTd, StatCard, Badge } from '@/components/admin/AdminUI'
import { errorMessage } from '@/lib/errors/error-message'
import type { HostApplication } from '@/types'

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })


const STATUS_COLOURS = {
  pending:  'gold',
  approved: 'green',
  rejected: 'red',
} as const

export default function HostApplications({
  onToast,
  onReviewed,
}: {
  onToast: (msg: string, ok?: boolean) => void
  /** Approving creates a host, so the host page refreshes its host list. */
  onReviewed: () => void
}) {
  const [applications, setApplications] = useState<HostApplication[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState<HostApplication | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/admin/host-applications')
    const json = await res.json().catch(() => ({}))
    if (!res.ok) onToast(errorMessage(json, 'Failed to load applications.'), false)
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

  const memberName = (a: HostApplication) =>
    a.member ? `${a.member.first_name} ${a.member.last_name}`.trim() : 'Unknown member'

  return (
    <>
      {!loading && (
        <div className="grid grid-cols-3 gap-3 mb-6">
          <StatCard label="Pending"  value={counts.pending  ?? 0} sub="Awaiting review" colour="gold" />
          <StatCard label="Approved" value={counts.approved ?? 0} sub="Now hosts"       colour="green" />
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
  application: HostApplication
  memberName: string
  onClose: () => void
  onReviewed: (msg: string) => void
  onError: (msg: string) => void
}) {
  const readOnly = application.status !== 'pending'

  // The applicant's proposed host name is the default.
  const proposedName = application.name?.trim() || memberName

  const [name, setName] = useState(proposedName)
  const [reason, setReason] = useState('')
  const [mode, setMode] = useState<'approve' | 'reject'>('approve')
  const [submitting, setSubmitting] = useState(false)

  // Resolve the requested venue ids for display. Approval grants exactly these
  // venues (the server reads requested_course_ids).
  //
  // Resolved against /api/admin/courses, not /api/courses: the latter is the
  // bookable list (active + calendar + payment link), so a club the applicant
  // proposed — which is a `pending` course by construction — resolved to nothing
  // and rendered as "Unknown venue" directly above the promise that approving
  // grants it. The admin list carries every status, so the venue can be named and
  // its status shown, which is the thing that decides whether it's ready.
  const [venues, setVenues] = useState<{ id: string; label: string; pending: boolean; known: boolean }[]>([])
  const requestedIds = application.requested_course_ids ?? []
  // Which venues the approval will actually grant. Defaults to everything the
  // applicant asked for; the admin can now drop individual ones, which the
  // approval route has always accepted as `course_ids` but nothing ever sent.
  const [grantIds, setGrantIds] = useState<string[]>(requestedIds)
  useEffect(() => {
    if (requestedIds.length === 0) { setVenues([]); return }
    fetch('/api/admin/courses')
      .then(r => r.json())
      .then((j: { courses?: { id: string; name: string; city: string | null; approval_status: string }[] }) => {
        const byId = new Map((j.courses ?? []).map(c => [c.id, c]))
        setVenues(requestedIds.map(id => {
          const c = byId.get(id)
          if (!c) return { id, label: 'Unknown venue', pending: false, known: false }
          return {
            id,
            label: c.city ? `${c.name} — ${c.city}` : c.name,
            pending: c.approval_status === 'pending',
            known: true,
          }
        }))
      })
      .catch(() => setVenues(requestedIds.map(id => ({ id, label: 'Unknown venue', pending: false, known: false }))))
    // requestedIds is derived from the immutable application prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleGrant = (id: string) =>
    setGrantIds(prev => (prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]))

  // Rounds the applicant proposed. Approving creates each of these as a live
  // event, so the admin picks which ones — the same shape as the venue grant.
  const proposedRounds = application.events ?? []
  const [roundIds, setRoundIds] = useState<string[]>(proposedRounds.map(r => r.id))

  const toggleRound = (id: string) =>
    setRoundIds(prev => (prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]))

  const today = new Date().toISOString().slice(0, 10)

  const field = 'w-full px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-green-700 outline-none transition-colors bg-white'
  const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

  async function submit() {
    if (submitting) return
    if (mode === 'reject' && !reason.trim()) {
      onError('A rejection reason is required.')
      return
    }
    // The server fails closed on an empty grant (it would otherwise leave the host
    // with no venue rows), so catch it here where the admin can still fix it.
    if (mode === 'approve' && requestedIds.length > 0 && grantIds.length === 0) {
      onError('Select at least one venue to grant.')
      return
    }
    setSubmitting(true)
    const res = await fetch(`/api/admin/host-applications/${application.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        mode === 'approve'
          ? { action: 'approve', name: name.trim(), course_ids: grantIds, event_ids: roundIds }
          : { action: 'reject', rejection_reason: reason.trim() }
      ),
    })
    const json = await res.json().catch(() => ({}))
    setSubmitting(false)
    if (!res.ok) { onError(errorMessage(json, 'Review failed.')); return }
    if (mode !== 'approve') { onReviewed('Application rejected.'); return }
    // Say how many rounds went live — the admin just chose them, so silence about
    // the outcome would leave them guessing whether it worked.
    const created = Number(json.events_created ?? 0)
    onReviewed(
      created > 0
        ? `${memberName} is now a host. ${created} ${created === 1 ? 'event' : 'events'} published.`
        : `${memberName} is now a host.`
    )
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
            <p className={labelCls}>Proposed host name</p>
            <p className="text-sm text-gray-800 font-medium">{proposedName}</p>
          </div>

          <div>
            <p className={labelCls}>Description</p>
            <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-xl px-4 py-3">
              {application.description}
            </p>
          </div>

          <div>
            <p className={labelCls}>Requested venues</p>
            {venues.length === 0 ? (
              <p className="text-sm text-gray-400">None specified</p>
            ) : readOnly ? (
              <ul className="text-sm text-gray-700 space-y-1">
                {venues.map(v => (
                  <li key={v.id} className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-700 flex-shrink-0" />
                    <span>{v.label}</span>
                    {v.pending && <Badge label="Pending" colour="gold" />}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="space-y-1">
                {venues.map(v => (
                  <label key={v.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-gray-300 text-green-800 focus:ring-green-700"
                      checked={grantIds.includes(v.id)}
                      // An id that resolves to nothing can't be granted — the
                      // course is gone, so offering it would fail server-side.
                      disabled={!v.known}
                      onChange={() => toggleGrant(v.id)}
                    />
                    <span className={v.known ? undefined : 'text-gray-400 line-through'}>{v.label}</span>
                    {v.pending && <Badge label="Pending" colour="gold" />}
                  </label>
                ))}
              </div>
            )}
            {!readOnly && <p className="mt-1 text-[11px] text-gray-400">Approving grants the host these venues.</p>}
          </div>

          {proposedRounds.length > 0 && (
            <div>
              <p className={labelCls}>Proposed rounds</p>
              <div className="space-y-1">
                {proposedRounds.map(r => {
                  // A round at a dropped venue can't be created, and one whose
                  // date has passed while the application sat in the queue can't
                  // become an upcoming event. Both are shown, disabled, so the
                  // reason is visible rather than the round just missing.
                  const venueDropped = !grantIds.includes(r.course_id)
                  const datePassed = r.event_date < today
                  const blocked = venueDropped || datePassed
                  const label = `${r.course?.name ?? 'Venue'} · ${r.event_date}${r.tee_time ? ` · ${r.tee_time}` : ''} · ${r.total_spots} spots · $${Number(r.member_guest_rate)}${r.dinner ? ' · dinner' : ''}`

                  if (readOnly) {
                    return (
                      <p key={r.id} className="text-sm text-gray-700 flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-700 flex-shrink-0" />
                        <span>{label}</span>
                        {r.hosted_event_id && <Badge label="Created" colour="green" />}
                      </p>
                    )
                  }

                  return (
                    <label key={r.id} className="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        className="h-4 w-4 mt-0.5 rounded border-gray-300 text-green-800 focus:ring-green-700"
                        checked={roundIds.includes(r.id) && !blocked}
                        disabled={blocked}
                        onChange={() => toggleRound(r.id)}
                      />
                      <span className={blocked ? 'text-gray-400' : undefined}>
                        {label}
                        {datePassed && <span className="text-amber-600"> (date passed)</span>}
                        {venueDropped && !datePassed && <span className="text-amber-600"> (venue not granted)</span>}
                      </span>
                    </label>
                  )
                })}
              </div>
              {!readOnly && (
                <p className="mt-1 text-[11px] text-gray-400">
                  Approving publishes the selected rounds as live events.
                </p>
              )}
            </div>
          )}

          {readOnly ? (
            <div className="rounded-xl px-4 py-3 bg-gray-50 border border-gray-100">
              <p className="text-xs text-gray-500">
                {application.status === 'approved'
                  ? 'Approved — this member is now a host.'
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
                <div>
                  <label htmlFor="review-name" className={labelCls}>Host Name *</label>
                  <input
                    id="review-name"
                    className={field}
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="Jane Smith"
                  />
                  <p className="mt-1 text-[11px] text-gray-400">
                    How the host is shown to members. Defaults to what they proposed.
                  </p>
                </div>
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
                  : mode === 'approve' ? 'Approve & create host' : 'Reject application'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
