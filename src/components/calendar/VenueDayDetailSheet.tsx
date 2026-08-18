'use client'

// Detail modal for one venue on one day, opened from the aggregated month
// calendar on /book. It answers "is this the round I want" — venue, where, what
// it costs, when the tee times start, what the club's rules say — and hands off
// to the normal booking flow with that venue and date already chosen.
//
// A bottom sheet on phones and a centred dialog from md up, matching the other
// sheets on this page.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Image from 'next/image'
import { ChevronRight, MapPin, Globe, Phone, Users, X } from 'lucide-react'
import { format, addMinutes, parse } from 'date-fns'
import { cn, formatTeeTime } from '@/lib/utils'
import { BOOKING_PRICE_USD } from '@/lib/constants'
import type { Course, GHLBookingSlot } from '@/types'

export interface VenueDayDetail {
  course: Course
  /** YYYY-MM-DD */
  date: string
  /** Bookable tee times that day. */
  openSlots: number
  /** Seats across them, already clamped to the venue's daily cap. */
  openSpots: number
  /**
   * How many of the member's rounds are still awaiting payment, anywhere. The
   * FIFO gate is global — one unpaid round blocks a new booking at every
   * venue — so this isn't scoped to the course in front of them.
   */
  pendingCount: number
}

// The month payload only previews a few tee times per venue-day, which is
// enough to decide whether to open the sheet but not enough to book from. The
// full day comes from the per-venue month endpoint — the same call the old
// selection screen made, moved here rather than added.
function slotEndLabel(startIso: string, durationMins: number): string {
  const timeStr = startIso.split('T')[1]?.slice(0, 8) ?? '00:00:00'
  return format(addMinutes(parse(timeStr, 'HH:mm:ss', new Date()), durationMins), 'h:mm a')
}

const slotTime = (iso: string) => formatTeeTime(iso.split('T')[1]?.slice(0, 8) ?? '')

export default function VenueDayDetailSheet({
  detail,
  onClose,
  onBook,
}: {
  /** null closes the sheet (kept mounted through the exit transition). */
  detail: VenueDayDetail | null
  onClose: () => void
  /** Picking a tee time IS the booking — it goes straight to confirmation. */
  onBook: (course: Course, date: string, slot: GHLBookingSlot) => void
}) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  // The day's full tee-time list, fetched when the sheet opens.
  const [slots, setSlots] = useState<GHLBookingSlot[] | null>(null)
  const [durationMins, setDurationMins] = useState<number | null>(null)
  const [slotsError, setSlotsError] = useState(false)
  // Held through the close animation so the sheet still has something to render
  // while it slides out.
  const [shown, setShown] = useState<VenueDayDetail | null>(detail)

  useEffect(() => {
    if (detail) {
      setShown(detail)
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
  }, [detail])

  useEffect(() => {
    if (!detail) return
    const { course, date } = detail
    let current = true
    setSlots(null)
    setDurationMins(null)
    setSlotsError(false)
    fetch(`/api/bookings/create?month=${date.slice(0, 7)}&courseId=${course.id}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(d.error ?? 'Failed to load tee times.')
        return d
      })
      .then((d) => {
        if (!current) return
        const all: GHLBookingSlot[] = Array.isArray(d.slots?.[date]) ? d.slots[date] : []
        setSlots(all.filter(sl => sl.available && (sl.spotsOpen ?? 0) > 0))
        setDurationMins(typeof d.durationMins === 'number' ? d.durationMins : null)
      })
      .catch(() => {
        if (!current) return
        setSlots([])
        setSlotsError(true)
      })
    return () => {
      current = false
    }
  }, [detail])

  // Escape closes, and the page behind stays put while the sheet is up.
  useEffect(() => {
    if (!detail) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [detail, onClose])

  if (!mounted || !shown) return null

  const { course, date, openSlots, openSpots, pendingCount } = shown
  const location = [course.city, course.state].filter(Boolean).join(', ')
  const longDate = format(new Date(`${date}T12:00:00`), 'EEEE, MMMM d')
  // Courses carry their own rate; BOOKING_PRICE_USD is the house default the
  // confirm screen quotes when one isn't set, so the sheet can always name a
  // price rather than going silent on the question that decides the booking.
  const pricePerPlayer = course.cost_per_player ?? BOOKING_PRICE_USD
  // The FIFO gate is enforced server-side on POST /api/bookings/create too;
  // this only keeps the member from walking into a rejection.
  const blocked = pendingCount > 0

  const sheet = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${course.name} on ${longDate}`}
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
        {/* Drag handle — phones only; the desktop dialog has a close button. */}
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
          {/* Header — logo, name, where */}
          <div className="flex items-start gap-3.5">
            <div className="relative w-16 h-16 rounded-2xl overflow-hidden flex-shrink-0 bg-green-900/[0.03]">
              <Image src={course.logo_url} alt="" fill unoptimized className="object-contain" />
            </div>
            <div className="flex-1 min-w-0 pt-0.5">
              <h2 className="font-sans font-black text-lg leading-tight text-green-950">
                {course.name}
              </h2>
              {location && (
                <p className="mt-1 flex items-center gap-1 text-xs text-green-900/45">
                  <MapPin className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />
                  <span className="truncate">{location}</span>
                </p>
              )}
              <p className="mt-1 text-xs font-bold" style={{ color: 'var(--color-gold-dark, #92640a)' }}>
                ${pricePerPlayer}/player
              </p>
            </div>
          </div>

          {/* The day itself — the reason this sheet is open. */}
          <div className="mt-4 rounded-2xl border border-green-900/[0.07] bg-green-900/[0.02] px-4 py-3.5">
            <p className="text-[10px] uppercase tracking-wider font-medium text-green-900/40">
              Selected date
            </p>
            <p className="mt-0.5 font-sans font-black text-base text-green-950">{longDate}</p>

            <div className="mt-2.5 flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                <Users className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
                {openSpots} spot{openSpots === 1 ? '' : 's'} open
              </span>
            </div>

            <p className="mt-2 text-[11px] text-green-900/40">
              Times are local to the venue.
            </p>
          </div>

          {/* Tee times — picking one goes straight to confirmation, so this is
              the booking step rather than a preview of one. */}
          <div className="mt-4">
            <p className="text-[10px] uppercase tracking-wider font-medium text-green-900/40 mb-2">
              Pick a tee time
            </p>

            {blocked ? (
              <div className="rounded-2xl px-4 py-3.5" style={{ background: 'rgba(146,100,10,0.08)' }}>
                <p className="text-xs font-bold" style={{ color: '#92640a' }}>
                  💳 {pendingCount} payment{pendingCount === 1 ? '' : 's'} due
                </p>
                <p className="mt-1 text-[11px]" style={{ color: '#92640a' }}>
                  Settle {pendingCount === 1 ? 'it' : 'them'} from the banner on the
                  booking screen before reserving another round.
                </p>
              </div>
            ) : slots === null ? (
              <div className="space-y-2" aria-hidden>
                {/* The month payload already told us roughly how many to expect,
                    so the placeholder matches the shape that's coming. */}
                {Array.from({ length: Math.min(openSlots || 3, 4) }).map((_, i) => (
                  <div key={i} className="h-14 rounded-2xl animate-pulse bg-green-900/[0.05]" />
                ))}
              </div>
            ) : slots.length === 0 ? (
              <p className="text-sm text-green-900/55 px-1 py-3">
                {slotsError
                  ? "Couldn't load tee times. Close and try again."
                  : 'These tee times have just been taken. Try another day.'}
              </p>
            ) : (
              <div className="space-y-2">
                {slots.map(sl => (
                  <button
                    key={sl.startTime}
                    type="button"
                    onClick={() => onBook(course, date, sl)}
                    className="w-full text-left flex items-center justify-between gap-3 rounded-2xl border border-green-900/10 bg-white px-4 py-3 transition-colors hover:bg-green-50/50 active:opacity-70"
                  >
                    <span className="min-w-0">
                      <span className="block font-sans font-black text-xl text-green-950">
                        {slotTime(sl.startTime)}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-green-900/45">
                        {durationMins !== null && (
                          <>until ~{slotEndLabel(sl.startTime, durationMins)} </>
                        )}
                        <span aria-hidden className="text-green-900/25">·</span>{' '}
                        <span
                          className={cn(
                            'font-medium',
                            (sl.spotsOpen ?? 0) <= 3 ? 'text-amber-700' : 'text-green-900/45',
                          )}
                        >
                          {sl.spotsOpen} spot{sl.spotsOpen === 1 ? '' : 's'} open
                        </span>
                      </span>
                    </span>
                    <ChevronRight className="w-4 h-4 flex-shrink-0 text-green-900/25" strokeWidth={2} />
                  </button>
                ))}
              </div>
            )}
          </div>

          {course.description && (
            <div className="mt-4">
              <p className="text-[10px] uppercase tracking-wider font-medium text-green-900/40 mb-1">
                About
              </p>
              <p className="text-sm leading-relaxed text-green-900/70">{course.description}</p>
            </div>
          )}

          {course.booking_rules && (
            <div className="mt-4 rounded-2xl border border-green-900/[0.07] px-4 py-3.5">
              <p className="text-[10px] uppercase tracking-wider font-medium text-green-900/40 mb-1">
                Good to know
              </p>
              <p className="text-sm leading-relaxed text-green-900/70">{course.booking_rules}</p>
            </div>
          )}

          {(course.address || course.phone || course.map_link || course.booking_url) && (
            <div className="mt-4 space-y-1.5">
              {course.address && (
                <p className="flex items-start gap-2 text-xs text-green-900/55">
                  <MapPin className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" strokeWidth={2} />
                  <span>{course.address}</span>
                </p>
              )}
              {course.phone && (
                <a
                  href={`tel:${course.phone}`}
                  className="flex items-center gap-2 text-xs text-green-800 hover:underline"
                >
                  <Phone className="w-3.5 h-3.5 flex-shrink-0" strokeWidth={2} />
                  {course.phone}
                </a>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                {course.map_link && (
                  <a
                    href={course.map_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-green-900/10 text-green-900/65 hover:bg-green-50"
                  >
                    <MapPin className="w-3.5 h-3.5" strokeWidth={2} />
                    Map
                  </a>
                )}
                {course.booking_url && (
                  <a
                    href={course.booking_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-green-900/10 text-green-900/65 hover:bg-green-50"
                  >
                    <Globe className="w-3.5 h-3.5" strokeWidth={2} />
                    Website
                  </a>
                )}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )

  return createPortal(sheet, document.body)
}
