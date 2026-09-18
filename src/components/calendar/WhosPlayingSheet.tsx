'use client'

// Who's playing on one day — opened from the avatars on a day of the aggregated
// month calendar on /book. Lists the members booked that day by venue, then by
// tee time, so a member can see who they'd be out with before they book.
//
// A bottom sheet on phones and a centred dialog from md up, matching
// VenueDayDetailSheet, which it sits beside.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Clock, X } from 'lucide-react'
import { format } from 'date-fns'
import Avatar from '@/components/ui/Avatar'
import { cn, formatTeeTime, titleCaseName } from '@/lib/utils'
import { VENUE_DOT as DOT } from '@/components/calendar/venue-colours'
import type { CalendarPlayer } from '@/lib/bookings/players'

export interface WhosPlayingDay {
  /** YYYY-MM-DD */
  date: string
  players: CalendarPlayer[]
}

interface TeeGroup {
  teeTime: string
  players: CalendarPlayer[]
}

interface VenueGroup {
  courseId: string
  name: string
  colourIdx: number
  tees: TeeGroup[]
}

export default function WhosPlayingSheet({
  day,
  venueNames,
  colourByVenue,
  onClose,
}: {
  /** null closes the sheet (kept mounted through the exit transition). */
  day: WhosPlayingDay | null
  venueNames: Map<string, string>
  colourByVenue: Map<string, number>
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

  // Venue, then tee time. Players arrive sorted by tee time, so each group
  // keeps that order; venues follow the calendar's own (name) order.
  const venues = useMemo<VenueGroup[]>(() => {
    if (!shown) return []
    const byVenue = new Map<string, Map<string, CalendarPlayer[]>>()
    for (const p of shown.players) {
      const tees = byVenue.get(p.courseId) ?? new Map<string, CalendarPlayer[]>()
      const list = tees.get(p.teeTime) ?? []
      list.push(p)
      tees.set(p.teeTime, list)
      byVenue.set(p.courseId, tees)
    }
    return Array.from(byVenue.entries())
      .map(([courseId, tees]) => ({
        courseId,
        name: venueNames.get(courseId) ?? 'Venue',
        colourIdx: colourByVenue.get(courseId) ?? 0,
        tees: Array.from(tees.entries()).map(([teeTime, players]) => ({ teeTime, players })),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [shown, venueNames, colourByVenue])

  if (!mounted || !shown) return null

  const longDate = format(new Date(`${shown.date}T12:00:00`), 'EEEE, MMMM d')
  const count = shown.players.length

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
                        {tee.players.map(p => {
                          const name = titleCaseName(`${p.firstName} ${p.lastName}`.trim()) || 'Member'
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
