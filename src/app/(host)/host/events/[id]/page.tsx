'use client'

// Host event detail: who has reserved a spot, and the proof submitted for
// credit. The list page handles create/edit/publish/cancel; this is the
// "who's coming" view a host needs to actually run the event.

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { AdminPageHeader, AdminCard, Badge, ProgressBar } from '@/components/admin/AdminUI'
import { ContentLoader } from '@/components/ui/Loading'
import Avatar from '@/components/ui/Avatar'
import type { HostedEvent, HostedEventRegistration, HostedEventStatus } from '@/types'

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

const fmtDateTime = (d: string) =>
  new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

const fmtTime = (t: string | null) => {
  if (!t) return null
  const [h, m] = t.split(':')
  const hour = Number(h)
  return `${hour % 12 || 12}:${m} ${hour >= 12 ? 'PM' : 'AM'}`
}

const STATUS_META: Record<HostedEventStatus, { label: string; colour: 'green' | 'gold' | 'red' | 'blue' | 'gray' }> = {
  draft:                   { label: 'Draft',            colour: 'gray' },
  pending_review:          { label: 'Awaiting review',  colour: 'gold' },
  upcoming:                { label: 'Upcoming',         colour: 'green' },
  completed:               { label: 'Completed',        colour: 'blue' },
  pending_credit_approval: { label: 'Credit approval',  colour: 'gold' },
  credits_awarded:         { label: 'Credits awarded',  colour: 'green' },
  cancelled:               { label: 'Cancelled',        colour: 'red' },
}

export default function HostEventDetailPage() {
  const params = useParams()
  const id = String(params?.id ?? '')

  const [event, setEvent] = useState<HostedEvent | null>(null)
  const [registrations, setRegistrations] = useState<HostedEventRegistration[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch(`/api/host/events/${id}`)
    const json = await res.json().catch(() => ({}))
    if (res.ok) { setEvent(json.event); setRegistrations(json.registrations ?? []) }
    else setError(json.error ?? 'Could not load this event.')
    setLoading(false)
  }, [id])

  useEffect(() => { if (id) load() }, [id, load])

  const filled = event?.filled_spots ?? 0
  const meta = event ? STATUS_META[event.status] : null

  return (
    <div className="p-4 sm:p-8 max-w-3xl mx-auto">
      <Link href="/host/events" className="text-xs text-gray-400 hover:text-gray-600">← My events</Link>

      {loading ? (
        <ContentLoader />
      ) : !event ? (
        <div className="py-16 text-center text-sm text-red-500">{error ?? 'Event not found.'}</div>
      ) : (
        <>
          <AdminPageHeader
            title={event.course?.name ?? 'Hosted event'}
            description={`${fmtDate(event.event_date)}${event.tee_time ? ` · ${fmtTime(event.tee_time)}` : ''}`}
            action={meta ? <Badge label={meta.label} colour={meta.colour} /> : undefined}
          />

          <AdminCard title="Spots">
            <div className="flex items-center justify-between text-sm text-gray-600 mb-2">
              <span>{filled} of {event.total_spots} filled</span>
              <span>{event.remaining_spots ?? (event.total_spots - filled)} left</span>
            </div>
            <ProgressBar value={filled} max={event.total_spots} />
            <p className="text-xs text-gray-500 mt-3">
              Members pay {fmtMoney(event.member_price ?? event.member_guest_rate)} · your guest rate {fmtMoney(event.member_guest_rate)}
              {' · '}credit for this event {fmtMoney(event.member_guest_rate)}
            </p>
          </AdminCard>

          <AdminCard title={`Registered members (${registrations.length})`}>
            {registrations.length === 0 ? (
              <p className="text-sm text-gray-400 italic py-6 text-center">
                No one has reserved a spot yet.
              </p>
            ) : (
              <div className="divide-y divide-gray-50">
                {registrations.map(r => (
                  <div key={r.id} className="py-3 flex items-center gap-3">
                    <Avatar
                      avatarUrl={r.member?.avatar_url ?? null}
                      firstName={r.member?.first_name ?? ''}
                      lastName={r.member?.last_name ?? ''}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {`${r.member?.first_name ?? ''} ${r.member?.last_name ?? ''}`.trim() || 'Member'}
                      </p>
                      <p className="text-xs text-gray-400">Reserved {fmtDateTime(r.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </AdminCard>

          {(event.proofs?.length ?? 0) > 0 && (
            <AdminCard title="Submitted proof">
              <div className="flex gap-2 flex-wrap">
                {event.proofs?.map(p => (
                  <a key={p.id} href={p.image_url} target="_blank" rel="noopener noreferrer" className="block">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image_url} alt="Event proof" className="w-24 h-24 object-cover rounded-lg border border-gray-200" />
                  </a>
                ))}
              </div>
              {event.status === 'pending_credit_approval' && (
                <p className="text-xs text-amber-600 mt-3">Awaiting admin approval for your credit.</p>
              )}
            </AdminCard>
          )}

          {event.description && (
            <AdminCard title="Details">
              <p className="text-sm text-gray-600 whitespace-pre-wrap">{event.description}</p>
            </AdminCard>
          )}

          {event.status === 'cancelled' && event.cancellation_reason && (
            <AdminCard title="Cancellation">
              <p className="text-sm text-gray-600">{event.cancellation_reason}</p>
            </AdminCard>
          )}
        </>
      )}
    </div>
  )
}
