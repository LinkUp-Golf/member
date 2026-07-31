import { memo } from 'react'
import Link from 'next/link'
import { CalendarDays, Clock, MapPin, Users } from 'lucide-react'
import { memberPrice } from '@/lib/hosts/events'
import { formatEventTeeTime as fmtTime, cn } from '@/lib/utils'
import type { HostedEvent } from '@/types'

// One member-hosted event, as shown in the browse list and the calendar's
// selected-day panel. Links to the reservation page.

const fmtMoney = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 2 })

const fmtDate = (d: string) =>
  new Date(`${d.slice(0, 10)}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

function hostLabel(e: HostedEvent) {
  const m = e.host?.member
  const person = m ? `${m.first_name} ${m.last_name}`.trim() : ''
  return e.host?.name || person || 'A member'
}

interface Props {
  e: HostedEvent
  /** Drop the date line — the calendar's day panel is already headed by it. */
  hideDate?: boolean
}

const HostedEventCard = memo(function HostedEventCard({ e, hideDate }: Props) {
  const remaining = e.remaining_spots ?? 0
  const full = remaining <= 0
  // A reservation list can include events that are no longer open.
  const open = e.status === 'upcoming'
  const scarce = open && !full && remaining <= 2
  const time = fmtTime(e.tee_time)

  return (
    <Link href={`/more/hosted-events/${e.id}`} className="card card-pad block hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-green-950">{e.course?.name ?? 'Course'}</p>
          <p className="text-xs text-green-900/50 mt-1 flex items-center gap-1">
            {hideDate ? (
              <>
                <Clock className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} />
                {time ?? 'Tee time to be confirmed'}
              </>
            ) : (
              <>
                <CalendarDays className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} />
                {fmtDate(e.event_date)}{time ? ` · ${time}` : ''}
              </>
            )}
          </p>
          {e.course?.city && (
            <p className="text-xs text-green-900/50 mt-0.5 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} />
              {e.course.city}
            </p>
          )}
          {e.dinner && <p className="text-xs text-green-800 mt-0.5 font-medium">🍽 Dinner included</p>}
          <p className="text-xs text-green-900/40 mt-1">Hosted by {hostLabel(e)}</p>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-sm font-bold text-green-950">{fmtMoney(e.member_price ?? memberPrice(e.member_guest_rate))}</p>
          <p className="text-[11px] text-green-900/40">per member</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <span className={cn('text-xs flex items-center gap-1', scarce ? 'text-orange-700 font-medium' : 'text-green-900/55')}>
          <Users className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={1.75} />
          {!open
            ? (e.status === 'cancelled' ? 'Cancelled' : 'Finished')
            : full
              ? `Full · ${e.total_spots} spots`
              : `${remaining} of ${e.total_spots} spots left`}
        </span>
        {e.is_registered ? (
          <span className="text-xs font-medium text-green-700 flex-shrink-0">You&apos;re in ✓</span>
        ) : !open ? (
          <span className="text-xs text-green-900/40 flex-shrink-0">Closed</span>
        ) : full ? (
          <span className="text-xs text-green-900/40 flex-shrink-0">No spots left</span>
        ) : (
          <span className="text-xs font-medium text-green-800 flex-shrink-0">Reserve →</span>
        )}
      </div>
    </Link>
  )
})

export default HostedEventCard
