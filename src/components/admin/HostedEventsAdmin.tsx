'use client'

// Admin: review what hosts have submitted, publish it, and settle their credit.
//
// Rounds are grouped by host + venue rather than listed one per date. A host
// picking three dates at one club submits three rows, and as a flat list that
// read as three unrelated jobs — the same venue, the same setup work, counted
// three times. One card per host+venue is what the work actually is: set the
// club up once, then publish the dates it covers.
//
// Two decisions live here, one per stage of a round's life:
//   waiting to publish → the calendar exists, put it in front of members
//   waiting on credit  → the round ran and proof is in, settle what's owed

import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import { AdminCard, Badge } from '@/components/admin/AdminUI'
import { errorMessage } from '@/lib/errors/error-message'
import type { HostedEvent, HostedEventStatus } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 })

// Written out in full. "Sat, Aug 16" saves a line nobody needed saving.
const fmtDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

const fmtShortDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

// Plain words. The database's names for these states are not the admin's
// problem, and "pending_approval" told them nothing about what to do.
const STATUS_META: Record<HostedEventStatus, { label: string; colour: 'green' | 'gold' | 'red' | 'blue' | 'gray' }> = {
  pending_approval:        { label: 'Waiting for you', colour: 'gold' },
  upcoming:                { label: 'Live',            colour: 'green' },
  completed:               { label: 'Finished',        colour: 'blue' },
  pending_credit_approval: { label: 'Credit to pay',   colour: 'gold' },
  credits_awarded:         { label: 'Credit paid',     colour: 'green' },
  cancelled:               { label: 'Taken down',      colour: 'red' },
}

const FILTERS: { key: string; label: string }[] = [
  // The two queues first, in the order a round moves through them. Everything
  // after is history — there to look something up, not to act on.
  { key: 'pending_approval', label: 'Waiting for you' },
  { key: 'pending_credit_approval', label: 'Credit to pay' },
  { key: 'upcoming', label: 'Live' },
  { key: 'completed', label: 'Finished' },
  { key: 'credits_awarded', label: 'Credit paid' },
  { key: 'cancelled', label: 'Taken down' },
  { key: '', label: 'Everything' },
]

function hostLabel(e: HostedEvent) {
  const m = e.host?.member
  const person = m ? `${m.first_name} ${m.last_name}`.trim() : ''
  return e.host?.name || person || 'Host'
}

/** One host's rounds at one venue. */
interface EventGroup {
  key: string
  host: string
  venue: string
  city: string | null
  events: HostedEvent[]
}

function groupEvents(events: HostedEvent[]): EventGroup[] {
  const byKey = new Map<string, EventGroup>()
  for (const e of events) {
    const key = `${e.host_id}|${e.course_id}`
    let group = byKey.get(key)
    if (!group) {
      group = {
        key,
        host: hostLabel(e),
        venue: e.course?.name ?? 'Course',
        city: e.course?.city ?? null,
        events: [],
      }
      byKey.set(key, group)
    }
    group.events.push(e)
  }
  // Dates ascending inside a card — a schedule reads forwards. The cards
  // themselves keep the order the server sent, which is already the right one
  // for the view being looked at (oldest first for a queue, newest for history).
  for (const g of byKey.values()) {
    g.events.sort((a, b) => a.event_date.localeCompare(b.event_date))
  }
  return Array.from(byKey.values())
}

export default function HostedEventsAdmin({ onToast }: { onToast: (msg: string, ok?: boolean) => void }) {
  const [events, setEvents] = useState<HostedEvent[]>([])
  const [loading, setLoading] = useState(true)
  // Opens on the queue that blocks hosts: until someone publishes, nothing they
  // submitted is visible to a single member.
  const [filter, setFilter] = useState('pending_approval')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [truncated, setTruncated] = useState(false)
  const [search, setSearch] = useState('')
  // Bumped on every load; a response from an older request is discarded. Without
  // it, clicking two filters quickly could leave the slower response rendered
  // under the newer filter.
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const seq = ++requestRef.current
    setLoading(true)
    try {
      const qs = filter ? `?status=${filter}` : ''
      const res = await fetch(`/api/admin/hosted-events${qs}`)
      const json = await res.json().catch(() => ({}))
      if (seq !== requestRef.current) return
      if (res.ok) {
        setEvents(Array.isArray(json.events) ? json.events : [])
        setCounts(json.counts ?? {})
        setTruncated(json.truncated === true)
      } else {
        onToast(errorMessage(json, 'Could not load rounds.'), false)
      }
    } catch {
      if (seq === requestRef.current) onToast('Could not load rounds.', false)
    } finally {
      if (seq === requestRef.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  useEffect(() => { load() }, [load])

  const term = search.trim().toLowerCase()
  const groups = useMemo(() => {
    const matching = term
      ? events.filter(e =>
          [hostLabel(e), e.course?.name ?? '', e.course?.city ?? '']
            .some(v => v.toLowerCase().includes(term))
        )
      : events
    return groupEvents(matching)
  }, [events, term])

  const dateCount = groups.reduce((n, g) => n + g.events.length, 0)

  return (
    <>
      <div className="flex gap-1.5 flex-wrap mb-3">
        {FILTERS.map(f => {
          const count = counts[f.key] ?? 0
          const on = filter === f.key
          return (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              aria-pressed={on}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${
                on ? 'bg-green-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f.label}
              {count > 0 && (
                <span
                  className={`ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                    on ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      <input
        type="search"
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search by host or venue"
        className="w-full mb-4 px-3 py-2 text-sm rounded-xl border border-gray-200 focus:border-green-700 outline-none transition-colors"
      />

      {truncated && (
        <p className="mb-3 text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2">
          Showing the first {events.length} rounds in this view. Pick a narrower
          tab to see the rest.
        </p>
      )}

      {loading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
      ) : groups.length === 0 ? (
        <AdminCard>
          <p className="text-sm text-gray-500 py-6 text-center">
            {events.length === 0
              ? filter === 'pending_approval'
                ? 'Nothing is waiting for you. '
                : 'Nothing here yet.'
              : 'Nothing matches that search.'}
            {events.length === 0 && filter === 'pending_approval' && (
              <span className="block text-xs text-gray-400 mt-1">
                When a host submits a round, it appears here for you to publish.
              </span>
            )}
          </p>
        </AdminCard>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">
            {groups.length} {groups.length === 1 ? 'venue' : 'venues'} · {dateCount}{' '}
            {dateCount === 1 ? 'date' : 'dates'}
          </p>
          <div className="space-y-4">
            {groups.map(g => (
              <GroupCard key={g.key} group={g} onChanged={load} onToast={onToast} />
            ))}
          </div>
        </>
      )}
    </>
  )
}

// ---- One host's rounds at one venue --------------------------

const GroupCard = memo(function GroupCard({ group, onChanged, onToast }: {
  group: EventGroup
  onChanged: () => void
  onToast: (msg: string, ok?: boolean) => void
}) {
  const [publishingAll, setPublishingAll] = useState(false)

  const waiting = group.events.filter(e => e.status === 'pending_approval')
  const owed = group.events.filter(e => e.status === 'pending_credit_approval')
  const owedTotal = owed.reduce((n, e) => n + Number(e.member_guest_rate), 0)

  // Publishing is per-round on the server. Doing them one at a time here keeps
  // that contract rather than adding a bulk endpoint for one screen — and it
  // means a single failure reports which dates did go live instead of leaving
  // the admin guessing.
  async function publishAll() {
    if (publishingAll) return
    setPublishingAll(true)
    let done = 0
    let firstError = ''
    for (const e of waiting) {
      const res = await fetch(`/api/admin/hosted-events/${e.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
      if (res.ok) {
        done++
      } else {
        const json = await res.json().catch(() => ({}))
        if (!firstError) firstError = errorMessage(json, 'One of the dates could not be published.')
      }
    }
    setPublishingAll(false)
    if (done > 0) {
      onToast(
        firstError
          ? `${done} of ${waiting.length} published. ${firstError}`
          : `${done} ${done === 1 ? 'date is' : 'dates are'} live — members can reserve a spot now.`,
        !firstError,
      )
    } else {
      onToast(firstError || 'Nothing could be published.', false)
    }
    onChanged()
  }

  return (
    <div className="card card-pad">
      {/* Who and where, first and largest — it's how an admin finds the card
          they're looking for. */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{group.venue}</p>
          <p className="text-xs text-gray-500 mt-1">
            Hosted by {group.host}
            {group.city ? ` · ${group.city}` : ''}
          </p>
        </div>
        <Badge
          label={`${group.events.length} ${group.events.length === 1 ? 'date' : 'dates'}`}
          colour="gray"
        />
      </div>

      {/* What to do about it, said once for the whole card rather than repeated
          against every date. */}
      {waiting.length > 0 && (
        <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-100">
          <p className="text-xs font-semibold text-amber-900">
            {waiting.length} {waiting.length === 1 ? 'round is' : 'rounds are'} waiting for you
          </p>
          <p className="text-[11px] text-amber-800 mt-1 leading-relaxed">
            Members can&apos;t see {waiting.length === 1 ? 'it' : 'them'} yet. Set this
            venue up in GHL and put {group.host} on the calendar, then publish{' '}
            {waiting.length === 1 ? 'the date' : `all ${waiting.length} dates`} below.
          </p>
          {waiting.length > 1 && (
            <button
              onClick={publishAll}
              disabled={publishingAll}
              className="btn btn-sm bg-green-800 text-white mt-2.5"
            >
              {publishingAll
                ? `Publishing… `
                : `Publish all ${waiting.length} dates`}
            </button>
          )}
        </div>
      )}

      {owed.length > 0 && (
        <div className="mt-4 p-3 rounded-xl bg-amber-50 border border-amber-100">
          <p className="text-xs font-semibold text-amber-900">
            {owed.length} {owed.length === 1 ? 'round has' : 'rounds have'} credit to settle
          </p>
          <p className="text-[11px] text-amber-800 mt-1">
            {fmtMoney(owedTotal)} in total, if you approve each at the listed amount.
          </p>
        </div>
      )}

      <div className="mt-4 space-y-3">
        {group.events.map(e => (
          <EventRow key={e.id} event={e} onChanged={onChanged} onToast={onToast} />
        ))}
      </div>
    </div>
  )
})

// ---- One date ------------------------------------------------

const EventRow = memo(function EventRow({ event, onChanged, onToast }: {
  event: HostedEvent
  onChanged: () => void
  onToast: (msg: string, ok?: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  // What the host gets credited. Starts at the rate the round was listed at,
  // which is what approving awards unless it's changed.
  const [amount, setAmount] = useState(String(event.member_guest_rate))
  const [note, setNote] = useState('')
  const meta = STATUS_META[event.status]
  const proofs = event.proofs ?? []

  // Only ask why when the figure has actually been changed — at the listed rate
  // there's nothing to explain.
  const overridden = Number(amount) !== Number(event.member_guest_rate)

  const awaitingCredit = event.status === 'pending_credit_approval'
  const awaitingApproval = event.status === 'pending_approval'
  const canTakeDown = event.status === 'upcoming' || awaitingApproval

  async function decide(action: 'approve' | 'reject') {
    if (busy) return
    if (action === 'reject' && !reason.trim()) { onToast('Please say why.', false); return }
    if (action === 'approve' && !(Number(amount) > 0)) {
      onToast('Enter a credit amount greater than zero.', false)
      return
    }
    setBusy(true)
    const res = await fetch(`/api/admin/hosted-events/${event.id}/credits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action === 'approve'
        ? { action, amount: Number(amount), ...(note.trim() ? { note: note.trim() } : {}) }
        : { action, reason: reason.trim() }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { onToast(errorMessage(json, 'That didn’t work.'), false); return }

    onToast(action === 'approve'
      ? `${fmtMoney(json.amount ?? event.member_guest_rate)} credited to the host.`
      : 'Credit turned down.')
    setRejecting(false); setReason(''); setNote('')
    onChanged()
  }

  // Publishes one date. Only press this once its GHL calendar exists — nothing
  // here can check that, so it's the admin's assertion.
  async function publish() {
    if (busy) return
    setBusy(true)
    const res = await fetch(`/api/admin/hosted-events/${event.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'approve' }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { onToast(errorMessage(json, 'Could not publish.'), false); return }
    onToast('Live — members can reserve a spot now.')
    onChanged()
  }

  // Cancels the round and releases anyone who reserved. There is no draft to
  // park it in, so this is final — the host would have to list it again.
  async function takeDown() {
    if (busy) return
    if (!reason.trim()) { onToast('Please say why.', false); return }
    setBusy(true)
    const res = await fetch(`/api/admin/hosted-events/${event.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reject', reason: reason.trim() }),
    })
    const json = await res.json().catch(() => ({}))
    setBusy(false)
    if (!res.ok) { onToast(errorMessage(json, 'That didn’t work.'), false); return }

    const released = Number(json.released ?? 0)
    onToast(released > 0
      ? `Taken down — ${released} ${released === 1 ? 'member has' : 'members have'} been released.`
      : 'Taken down.')
    setRejecting(false); setReason('')
    onChanged()
  }

  return (
    <div className="rounded-xl border border-gray-200 px-4 py-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-gray-900">{fmtDate(event.event_date)}</p>
          <p className="text-xs text-gray-500 mt-0.5">
            {event.filled_spots ?? 0} of {event.total_spots} spots taken · credit{' '}
            {fmtMoney(event.member_guest_rate)}
          </p>
        </div>
        <Badge label={meta.label} colour={meta.colour} />
      </div>

      {/* Proof thumbnails. The image is always the Supabase copy — that one is
          guaranteed to exist. The caption says whether the GHL mirror landed,
          so a silent run of failures is visible instead of only in the logs. */}
      {proofs.length > 0 && (
        <div className="flex gap-2 mt-3 flex-wrap">
          {proofs.map(p => (
            <div key={p.id} className="w-20">
              <a href={p.image_url} target="_blank" rel="noopener noreferrer" className="block">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.image_url} alt="Photo from the round" className="w-20 h-20 object-cover rounded-lg border border-gray-200" />
              </a>
              {p.ghl_media_url ? (
                <a
                  href={p.ghl_media_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block mt-1 text-[10px] font-medium text-green-800 hover:underline"
                >
                  In GHL ↗
                </a>
              ) : (
                <span className="block mt-1 text-[10px] text-gray-400">Not in GHL</span>
              )}
            </div>
          ))}
        </div>
      )}

      {event.source_booking_id && (
        <p className="text-[11px] text-gray-400 mt-2">Listed from one of the host&apos;s own bookings.</p>
      )}

      {/* rejection_reason on a cancelled round means an admin pulled it, rather
          than the host calling their own round off. */}
      {event.status === 'cancelled' && event.rejection_reason && (
        <p className="text-[11px] text-red-600 mt-2">Taken down: {event.rejection_reason}</p>
      )}

      {canTakeDown && (
        <div className="mt-3 flex flex-wrap gap-2">
          {awaitingApproval && !rejecting && (
            <button onClick={publish} disabled={busy} className="btn btn-sm bg-green-800 text-white">
              Publish {fmtShortDate(event.event_date)}
            </button>
          )}
          {!rejecting ? (
            <button onClick={() => setRejecting(true)} disabled={busy} className="btn btn-outline btn-sm text-red-600 border-red-200">
              Take down
            </button>
          ) : (
            <div className="w-full p-3 rounded-xl bg-red-50 border border-red-100 space-y-2">
              <p className="text-[11px] text-red-700 leading-relaxed">
                {awaitingApproval
                  ? 'This cancels the round before anyone sees it. Nobody has reserved a spot, but the host would have to add it again from scratch.'
                  : 'This cancels the round, takes it off the member list, and releases anyone who reserved a spot. The host would have to add it again from scratch.'}
              </p>
              <input
                className="input text-sm"
                placeholder="Why? (the host sees this)"
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={() => { setRejecting(false); setReason('') }} disabled={busy} className="btn btn-outline btn-sm flex-1">
                  Never mind
                </button>
                <button onClick={takeDown} disabled={busy} className="btn btn-sm flex-1 bg-red-600 text-white">
                  Yes, take it down
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {awaitingCredit && (
        <div className="mt-3">
          {proofs.length === 0 && (
            <p className="text-[11px] text-amber-600 mb-2">The host didn&apos;t upload a photo from this round.</p>
          )}
          {!rejecting ? (
            <div className="space-y-2">
              {/* Editable before approving, so a round that ran differently to
                  the listing can be credited for what it was actually worth. */}
              <div className="flex items-end gap-2 flex-wrap">
                <div>
                  <label htmlFor={`credit-${event.id}`} className="block text-[11px] font-medium text-gray-600 mb-1">
                    Credit to pay
                  </label>
                  <div className="relative w-32">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">$</span>
                    <input
                      id={`credit-${event.id}`}
                      type="number"
                      min={0}
                      step="1"
                      className="input text-sm pl-7"
                      value={amount}
                      onChange={e => setAmount(e.target.value)}
                    />
                  </div>
                </div>
                <button onClick={() => decide('approve')} disabled={busy} className="btn btn-sm bg-green-900 text-white">
                  Pay this credit
                </button>
                <button onClick={() => setRejecting(true)} disabled={busy} className="btn btn-outline btn-sm text-red-600 border-red-200">
                  Turn down
                </button>
              </div>

              {overridden && (
                <div className="space-y-1">
                  <p className="text-[11px] text-amber-600">
                    This round was listed at {fmtMoney(event.member_guest_rate)}.
                  </p>
                  <input
                    className="input text-sm"
                    placeholder="Why the different amount? (optional, kept on the record)"
                    value={note}
                    onChange={e => setNote(e.target.value)}
                  />
                </div>
              )}
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-red-50 border border-red-100 space-y-2">
              <input
                className="input text-sm"
                placeholder="Why? (the host sees this)"
                value={reason}
                onChange={e => setReason(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={() => { setRejecting(false); setReason('') }} disabled={busy} className="btn btn-outline btn-sm flex-1">
                  Never mind
                </button>
                <button onClick={() => decide('reject')} disabled={busy} className="btn btn-sm flex-1 bg-red-600 text-white">
                  Turn down credit
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
})
