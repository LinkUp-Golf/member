'use client'

// Who's coming to one hosted round — opened from the faces on a date row in the
// host's My Events list.
//
// The member app answers the same question on /book with WhosPlayingSheet, and
// this is deliberately the same gesture: tap the avatars, get the names. It's a
// separate component rather than that one reused because the question is a
// narrower one here — one round, one venue, one tee time, so there is nothing to
// group by — and because it says something that list can't: how each person got
// onto the round. The host workspace's greys are used rather than the member
// app's navy, since that's the screen it opens over.
//
// Once the round has run it is also where the host records who actually came:
// the same list, with a tick against each name. Nothing else knows the answer —
// a reservation is an intention and a booking is a seat, neither is attendance —
// and the host is standing at the club with the phone they upload the proof photo
// from, which is why the two live on the same row of their list.
//
// The ticks are whatever the host last saved, and everything else is blank:
// there is no "absent", so a name with no tick is both "didn't come" and "nobody
// has said yet". That is honest about a list a host may never open, and it's why
// a round nobody marked stores no rows at all rather than a table of falses.
//
// A bottom sheet on phones and a centred dialog from md up, matching the sheets
// in the member app so the two don't behave differently on the same device.

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Clock, X } from 'lucide-react'
import { format } from 'date-fns'
import Avatar from '@/components/ui/Avatar'
import { formatEventTeeTime, nameOrEmail } from '@/lib/utils'
import type { EventPlayer } from '@/types'

export interface RoundPlayers {
  /** YYYY-MM-DD */
  date: string
  venueName: string
  /** HH:MM[:SS], or null when the round has no fixed tee time. */
  teeTime: string | null
  players: EventPlayer[]
  /**
   * Saves who was present, as the whole set. Absent means the round hasn't
   * happened yet and the list is read-only — the same window as the proof photo,
   * decided by the row that opens this (canMarkAttendance).
   *
   * Resolves true when it saved. False leaves the tick where it was: a checkbox
   * that stays ticked after a failed save is a host believing they've recorded
   * something they haven't.
   */
  onMarkAttendance?: (memberIds: string[]) => Promise<boolean>
}

/** How each person got onto the round, in the host's terms. */
const SOURCE_LABEL: Record<EventPlayer['source'], string> = {
  reserved: 'Reserved a spot',
  booking: 'Booked this venue',
}

export default function RoundPlayersSheet({
  round,
  onClose,
}: {
  /** null closes the sheet (kept mounted through the exit transition). */
  round: RoundPlayers | null
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  const [visible, setVisible] = useState(false)
  // Held through the close animation so the sheet still has something to render.
  const [shown, setShown] = useState<RoundPlayers | null>(round)
  // Who is ticked, and whether a save is in flight. Local because a tick has to
  // land under the thumb that made it; the server is told immediately and a
  // refusal puts the tick back where it was.
  const [marked, setMarked] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (round) {
      setShown(round)
      setMarked(new Set(round.players.filter(p => p.attended).map(p => p.member_id)))
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
  }, [round])

  // Escape closes, and the page behind stays put while the sheet is up.
  useEffect(() => {
    if (!round) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [round, onClose])

  // Reservations before venue bookings, which is the order the roster arrives
  // in; this only splits them so each group can be counted under its own head.
  const groups = useMemo(() => {
    const players = shown?.players ?? []
    return (['reserved', 'booking'] as const)
      .map(source => ({ source, players: players.filter(p => p.source === source) }))
      .filter(g => g.players.length > 0)
  }, [shown])

  if (!mounted || !shown) return null

  const longDate = format(new Date(`${shown.date.slice(0, 10)}T12:00:00`), 'EEEE, MMMM d')
  const count = shown.players.length
  const save = shown.onMarkAttendance
  const attended = shown.players.filter(p => marked.has(p.member_id)).length

  /**
   * Tick or untick one person.
   *
   * The whole set goes to the server, not the change: it's what this sheet has,
   * and it makes a retry — or two quick taps — land on the same answer rather
   * than on a sequence of them. The tick moves first and goes back if the save
   * is refused.
   */
  async function toggle(memberId: string) {
    if (!save) return
    const next = new Set(marked)
    if (next.has(memberId)) next.delete(memberId)
    else next.add(memberId)
    setMarked(next)
    setSaving(true)
    const ok = await save(Array.from(next))
    setSaving(false)
    if (!ok) setMarked(marked)
  }

  const sheet = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Who's coming on ${longDate}`}
      className="fixed inset-0 z-[70] flex flex-col justify-end md:justify-center md:items-center md:p-6"
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
          <div className="w-10 h-1 rounded-full bg-gray-200" />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="hidden md:flex absolute top-4 right-4 z-10 w-8 h-8 rounded-full items-center justify-center bg-gray-100 text-gray-400 hover:bg-gray-200"
        >
          <X className="w-4 h-4" strokeWidth={2} />
        </button>

        <div
          className="flex-1 overflow-y-auto px-5 pt-2 md:pt-6"
          style={{ paddingBottom: 'max(1.5rem, calc(1.5rem + env(safe-area-inset-bottom)))' }}
        >
          <p className="text-[10px] uppercase tracking-wider font-medium text-gray-400">
            {save ? 'Who played' : 'Who’s coming'}
          </p>
          <h2 className="mt-0.5 text-lg font-bold leading-tight text-gray-900">{longDate}</h2>
          <p className="mt-1 flex items-center gap-1.5 flex-wrap text-xs text-gray-500">
            <span className="truncate">{shown.venueName}</span>
            {shown.teeTime && (
              <>
                <span aria-hidden className="text-gray-300">
                  ·
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 flex-shrink-0" strokeWidth={2} />
                  {formatEventTeeTime(shown.teeTime)}
                </span>
              </>
            )}
            <span aria-hidden className="text-gray-300">
              ·
            </span>
            <span>
              {count} member{count === 1 ? '' : 's'}
            </span>
          </p>

          {save && (
            // Said once, at the top, rather than as a label on every row. The
            // count is the host's own progress through the list, and "Saving…"
            // replaces it while one is in flight so a slow connection shows
            // something other than a tick that might not have landed.
            <p className="mt-2 flex items-center justify-between gap-2 rounded-xl bg-gray-50 px-3 py-2 text-xs text-gray-500">
              <span>Tick everyone who played.</span>
              <span className="flex-shrink-0 font-medium tabular-nums text-gray-600">
                {saving ? 'Saving…' : `${attended} of ${count}`}
              </span>
            </p>
          )}

          <div className="mt-4 space-y-4">
            {groups.map(group => (
              <section key={group.source}>
                {/* Only named when both kinds are present — one heading over the
                    whole list would be labelling the obvious. */}
                {groups.length > 1 && (
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    {SOURCE_LABEL[group.source]}
                  </h3>
                )}
                <ul className="mt-1.5 space-y-1.5">
                  {group.players.map(p => {
                    // Their address rather than the word "Member" when we hold
                    // no name for them — see nameOrEmail.
                    const name =
                      nameOrEmail(`${p.first_name} ${p.last_name}`, p.email) || 'Member'
                    const ticked = marked.has(p.member_id)
                    const row = (
                      <>
                        <Avatar
                          firstName={p.first_name}
                          lastName={p.last_name}
                          avatarUrl={p.avatar_url}
                          size="sm"
                          className="flex-shrink-0"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-medium text-gray-900 truncate">
                            {name}
                          </span>
                          {/* Said on the row when there's no heading to say it. */}
                          {groups.length === 1 && (
                            <span className="block text-xs text-gray-400">
                              {SOURCE_LABEL[p.source]}
                            </span>
                          )}
                        </span>
                      </>
                    )

                    if (!save) {
                      return (
                        <li key={p.member_id} className="flex items-center gap-2.5">
                          {row}
                        </li>
                      )
                    }

                    return (
                      <li key={p.member_id}>
                        {/* The whole row is the target, not just the box: this is
                            a list being worked through on a phone, one hand, at a
                            golf club. The native checkbox is hidden rather than
                            dropped so the row keeps a real control behind it —
                            focus, space bar and screen readers all come free. */}
                        <label
                          className={`flex cursor-pointer items-center gap-2.5 rounded-xl px-1 -mx-1 py-1 transition-colors ${
                            ticked ? 'bg-green-50' : 'hover:bg-gray-50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={ticked}
                            onChange={() => toggle(p.member_id)}
                          />
                          {row}
                          <span
                            aria-hidden
                            className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full border transition-colors ${
                              ticked
                                ? 'border-green-700 bg-green-700 text-white'
                                : 'border-gray-300 bg-white text-transparent'
                            }`}
                          >
                            <Check className="h-3.5 w-3.5" strokeWidth={3} />
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )

  return createPortal(sheet, document.body)
}
