'use client'

// Who's playing on one day — opened from the avatars on a day of the aggregated
// month calendar on /book. Lists the members booked that day by venue, then by
// tee time, so a member can see who they'd be out with before they book.
//
// Each tee time reads as a tee sheet does: the person taking the group out
// first, marked as the host, then whoever has joined them. The host is the user
// staffing the venue's GHL calendar — see @/lib/bookings/venue-hosts — so it's
// the same person the member's own booking confirmation names, and it's the same
// for every tee time at that venue until the club re-staffs it.
//
// A venue whose calendar names nobody simply has no host row. The day is still
// readable, which is why nothing here treats a missing host as an error.
//
// A bottom sheet on phones and a centred dialog from md up, matching
// VenueDayDetailSheet, which it sits beside.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Clock, X } from 'lucide-react'
import { format } from 'date-fns'
import Avatar from '@/components/ui/Avatar'
import { cn, formatTeeTime, nameOrEmail, titleCaseName } from '@/lib/utils'
import { VENUE_DOT as DOT } from '@/components/calendar/venue-colours'
import { buildTeeSheet, distinctPlayers, type VenueTeeSheet } from '@/lib/bookings/tee-sheet'
import type { DaySeats } from '@/lib/bookings/occupancy'
import type { CalendarPlayer } from '@/lib/bookings/players'
import type { VenueHost } from '@/lib/bookings/venue-hosts'

export interface WhosPlayingDay {
  /** YYYY-MM-DD */
  date: string
  players: CalendarPlayer[]
  /**
   * Seats taken and seats held per venue — the same numbers the day cell prints.
   * Passed so this sheet and that cell can't disagree: whatever it can't name,
   * it counts. Absent for a day the caller has no openings for.
   */
  seats?: ReadonlyMap<string, DaySeats>
}

/** A venue's tee sheet, plus how this calendar draws that venue. */
interface VenueGroup extends VenueTeeSheet {
  name: string
  colourIdx: number
}

/**
 * How the seats this list can't name are said.
 *
 * Two things take a seat without putting a member on the sheet: a non-member
 * guest, who has no profile to open, and a booking that isn't going ahead yet,
 * which still holds its seat against the venue's cap. Saying so is the point —
 * a venue reading "4 of 12 taken" above two names is a disagreement a member
 * would otherwise have to resolve by distrusting both.
 */
function unnamedSeatsLine(n: number, afterNames: boolean): string {
  const more = afterNames ? 'more ' : ''
  return n === 1
    ? `1 ${more}seat is taken — a guest, or a round that isn't confirmed yet.`
    : `${n} ${more}seats are taken — guests, or rounds that aren't confirmed yet.`
}

/** Initials for a host we may have only one name for. */
function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/)
  return { first: parts[0] ?? '', last: parts.slice(1).join(' ') }
}

/**
 * The host, at the head of a tee time.
 *
 * Styled a shade heavier than the players under it — it's the one row in the
 * group that isn't someone you might be playing alongside by chance. Opens their
 * profile when they're a member of ours; a club employee staffing the calendar
 * is still the host of the round and simply has no page to open.
 */
function HostRow({ host, isSelf }: { host: VenueHost; isSelf: boolean }) {
  const { first, last } = splitName(host.name)
  const row = (
    <>
      <Avatar
        firstName={first}
        lastName={last}
        avatarUrl={host.avatarUrl}
        size="sm"
        className="flex-shrink-0"
      />
      <span className="min-w-0 flex-1 text-sm font-semibold text-green-950 truncate">
        {titleCaseName(host.name) || 'Host'}
      </span>
      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-gold/20 text-green-900/70 flex-shrink-0">
        Host
      </span>
      {isSelf && (
        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-900/[0.06] text-green-900/60 flex-shrink-0">
          You
        </span>
      )}
    </>
  )

  return host.memberId && !isSelf ? (
    <Link
      href={`/members/${host.memberId}`}
      className="flex items-center gap-2.5 rounded-xl -mx-1 px-1 py-0.5 hover:bg-green-50/60"
    >
      {row}
    </Link>
  ) : (
    <div className="flex items-center gap-2.5">{row}</div>
  )
}

export default function WhosPlayingSheet({
  day,
  venueNames,
  colourByVenue,
  hostByVenue,
  onClose,
}: {
  /** null closes the sheet (kept mounted through the exit transition). */
  day: WhosPlayingDay | null
  venueNames: Map<string, string>
  colourByVenue: Map<string, number>
  /** Who runs each venue. Absent for a venue whose calendar names nobody. */
  hostByVenue?: Map<string, VenueHost>
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  // Held through the close animation so the sheet still has something to render.
  const [shown, setShown] = useState<WhosPlayingDay | null>(day)

  useEffect(() => {
    if (day) {
      setShown(day)
      setMounted(true)
      const ids: number[] = []
      ids[0] = requestAnimationFrame(() => {
        ids[1] = requestAnimationFrame(() => setVisible(true))
      })
      return () => ids.forEach(id => cancelAnimationFrame(id))
    }
    setVisible(false)
    const t = setTimeout(() => setMounted(false), 250)
    return () => clearTimeout(t)
  }, [day])

  // Escape closes, and the page behind stays put while the sheet is up.
  useEffect(() => {
    if (!day) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [day, onClose])

  // The arrangement — venue, host, tee time, players — is buildTeeSheet's; all
  // that's added here is how this calendar draws each venue, and the name order
  // it lists them in.
  const venues = useMemo<VenueGroup[]>(() => {
    if (!shown) return []
    return buildTeeSheet(shown.players, hostByVenue, shown.seats)
      .map(sheet => ({
        ...sheet,
        name: venueNames.get(sheet.courseId) ?? 'Venue',
        colourIdx: colourByVenue.get(sheet.courseId) ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [shown, venueNames, colourByVenue, hostByVenue])

  if (!mounted || !shown) return null

  const longDate = format(new Date(`${shown.date}T12:00:00`), 'EEEE, MMMM d')
  // People, not rows — see distinctPlayers.
  const count = distinctPlayers(shown.players)

  const sheet = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Who's playing on ${longDate}`}
      className="fixed inset-0 z-50 flex flex-col justify-end md:justify-center md:items-center md:p-6"
    >
      <button
        type="button"
        aria-label="Close"
        className="absolute inset-0 w-full h-full"
        style={{
          background: 'rgba(0,0,0,0.45)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 200ms ease-out',
        }}
        onClick={onClose}
      />

      <div
        className="relative bg-white rounded-t-3xl md:rounded-3xl w-full md:max-w-md flex flex-col overflow-hidden"
        style={{
          boxShadow: '0 -4px 32px rgba(0,0,0,0.12)',
          maxHeight: '85dvh',
          transform: visible ? 'translateY(0)' : 'translateY(100%)',
          transition: visible
            ? 'transform 340ms cubic-bezier(0.32,0.72,0,1)'
            : 'transform 240ms cubic-bezier(0.4,0,1,1)',
          willChange: 'transform',
        }}
      >
        <div className="flex justify-center pt-3 pb-1 flex-shrink-0 md:hidden">
          <div className="w-10 h-1 rounded-full bg-green-900/10" />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="hidden md:flex absolute top-4 right-4 z-10 w-8 h-8 rounded-full items-center justify-center bg-green-900/[0.06] text-green-900/50 hover:bg-green-900/10"
        >
          <X className="w-4 h-4" strokeWidth={2} />
        </button>

        <div
          className="flex-1 overflow-y-auto px-5 pt-2 md:pt-6"
          style={{ paddingBottom: 'max(1.5rem, calc(1.5rem + env(safe-area-inset-bottom)))' }}
        >
          <p className="text-[10px] uppercase tracking-wider font-medium text-green-900/40">
            Who&apos;s playing
          </p>
          <h2 className="mt-0.5 font-sans font-black text-lg leading-tight text-green-950">
            {longDate}
          </h2>
          <p className="mt-1 text-xs text-green-900/45">
            {count} member{count === 1 ? '' : 's'} booked · times are local to the venue
          </p>

          <div className="mt-4 space-y-4">
            {venues.map(venue => (
              <section key={venue.courseId}>
                <h3 className="flex items-center gap-2 text-sm font-bold text-green-950">
                  <span className={cn('w-2 h-2 rounded-full flex-shrink-0', DOT[venue.colourIdx])} />
                  <span className="truncate">{venue.name}</span>
                </h3>
                {/* The cell's own numbers, so the two can be read against each
                    other, and then the honest remainder. */}
                {venue.seats && venue.seats.totalSpots > 0 && (
                  <p className="mt-0.5 text-[11px] text-green-900/45">
                    {Math.min(venue.seats.bookedSpots, venue.seats.totalSpots)} of{' '}
                    {venue.seats.totalSpots} seat
                    {venue.seats.totalSpots === 1 ? '' : 's'} taken
                    {venue.seats.bookedSpots >= venue.seats.totalSpots && ' · full'}
                  </p>
                )}

                <div className="mt-2 space-y-2">
                  {venue.tees.map(tee => (
                    <div
                      key={tee.teeTime}
                      className="rounded-2xl border border-green-900/[0.07] px-3 py-2.5"
                    >
                      <p className="flex items-center gap-1 text-[11px] font-semibold text-green-900/55">
                        <Clock className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
                        {formatTeeTime(tee.teeTime)}
                      </p>
                      <ul className="mt-1.5 space-y-1.5">
                        {/* The tee sheet's own order: whoever is taking the
                            group out, then whoever has joined them. */}
                        {venue.host && (
                          <li key="host">
                            <HostRow host={venue.host} isSelf={venue.hostIsSelf} />
                          </li>
                        )}
                        {tee.players.map(p => {
                          // Their address rather than the word "Member" when we
                          // hold no name: four rows reading "Member" are four
                          // people the reader can't tell apart. See nameOrEmail.
                          const name =
                            nameOrEmail(`${p.firstName} ${p.lastName}`, p.email) || 'Member'
                          const row = (
                            <>
                              <Avatar
                                firstName={p.firstName}
                                lastName={p.lastName}
                                avatarUrl={p.avatarUrl}
                                size="sm"
                                className="flex-shrink-0"
                              />
                              <span className="min-w-0 flex-1 text-sm font-medium text-green-950 truncate">
                                {name}
                              </span>
                              {p.isSelf && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-900/[0.06] text-green-900/60 flex-shrink-0">
                                  You
                                </span>
                              )}
                            </>
                          )
                          return (
                            <li key={p.memberId}>
                              {/* Another member opens their profile; your own row has
                                  nowhere useful to go. */}
                              {p.isSelf ? (
                                <div className="flex items-center gap-2.5">{row}</div>
                              ) : (
                                <Link
                                  href={`/members/${p.memberId}`}
                                  className="flex items-center gap-2.5 rounded-xl -mx-1 px-1 py-0.5 hover:bg-green-50/60"
                                >
                                  {row}
                                </Link>
                              )}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ))}

                  {venue.unnamedSeats > 0 && (
                    // A venue whose every seat is one of those has no tee times
                    // here at all, so the host — still the person running the day
                    // — gets this box to themselves.
                    <div className="rounded-2xl border border-dashed border-green-900/[0.14] px-3 py-2.5">
                      {venue.tees.length === 0 && venue.host && (
                        <div className="mb-1.5">
                          <HostRow host={venue.host} isSelf={venue.hostIsSelf} />
                        </div>
                      )}
                      <p className="text-[11px] leading-relaxed text-green-900/45">
                        {unnamedSeatsLine(venue.unnamedSeats, venue.tees.length > 0)}
                      </p>
                    </div>
                  )}
                </div>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(sheet, document.body)
}
