// Slot-release notice: when a club is told that a tee time we hold there isn't
// full, and what the email says. Pure, so it's tested.
//
// Agreed between Greg and Aviara management (2026-11-28). 72 hours before every
// Aviara foursome with fewer than four players signed up, the golf shop gets an
// email saying so, copied to Greg: the club may then release the open places to
// its own players. Later sign-ups are not emailed; Greg adds them to the club's
// tee sheet himself.
//
// The address, the hours, the threshold and the wording are columns on the
// venue (`courses.slot_release_notice_*`, 20261128000002), edited on its admin
// form. The cron is /api/cron/slot-release-notices; one notice per tee time,
// claimed in `slot_release_notices` before it's sent.
//
// Which tee times: every tee time with bookings, and on a day nobody has booked,
// the tee time the club holds for us anyway (unbookedHeldTeeTimes) — the club
// needs to hear about an empty foursome most of all.
//
// Who counts: every seat held at that tee time, i.e. every booking row there
// that isn't cancelled or waitlisted — members, non-member guests and the
// playing host alike (Greg: "the count includes the host"). The same count the
// booking functions enforce capacity against. On an unbooked day, the playing
// host alone.

import { venueInstant, SEND_EARLY_MS, SEND_LATE_MS } from '@/lib/bookings/reminders'
import { playingMemberId } from '@/lib/bookings/players'
import { formatTeeTime } from '@/lib/utils'

export const DEFAULT_NOTICE_HOURS = 72
export const DEFAULT_NOTICE_MIN_PLAYERS = 4

/**
 * Greg's wording, as agreed with Aviara. The bracketed names are filled in per
 * tee time (fillNoticeBody); an admin editing the text keeps them to have them
 * filled.
 */
export const DEFAULT_NOTICE_BODY = `This is an automated email from LinkUp Golf.
[Host name] currently has a foursome booking on [event date] at [tee time]. We currently have [number of confirmed players] players confirmed and [open slots] slots open.

The event is still available to our members, but Aviara may release the remaining slots for individual sign ups. We will add any new signups to the tee sheet as they come in.

As always, thanks for your support.`

/** The placeholders the body may use, for the admin form's hint. */
export const NOTICE_PLACEHOLDERS = ['[Host name]', '[event date]', '[tee time]', '[number of confirmed players]', '[open slots]'] as const

/** When the notice for this tee time is due. */
export function noticeDueAt(date: string, teeTime: string, timezone: string, hoursBefore: number): Date {
  return new Date(venueInstant(date, teeTime, timezone).getTime() - hoursBefore * 60 * 60 * 1000)
}

/**
 * Whether this cron run should send it. The same window as the round
 * reminders: from 8 minutes before the moment to 30 minutes after, so one
 * missed run doesn't lose it, and a tee time first booked inside the window's
 * far side isn't told about late.
 */
export function isNoticeDue(
  date: string,
  teeTime: string,
  timezone: string,
  hoursBefore: number,
  now: Date,
): boolean {
  const at = noticeDueAt(date, teeTime, timezone, hoursBefore).getTime()
  const t = now.getTime()
  return t >= at - SEND_EARLY_MS && t <= at + SEND_LATE_MS
}

/** A booking row, as much of one as the count needs. */
export interface NoticeSeatRow {
  booking_date: string
  tee_time: string | null
  member_id: string
  player_member_id: string | null
  guest_name: string | null
  playing_host: boolean | null
  created_at?: string | null
}

export interface NoticeTeeTime {
  date: string
  /** 'HH:MM:SS' */
  teeTime: string
  players: number
  /** Who holds the host seat at this tee time, when someone does. */
  hostMemberId: string | null
  /** The earliest booker at this tee time — the fallback for the host's name. */
  firstBookerId: string
}

/** 'HH:MM' and 'HH:MM:SS' read as the same tee time. */
export function normaliseTeeTime(time: string): string {
  const [h = '00', m = '00', s = '00'] = time.split(':')
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.slice(0, 2).padStart(2, '0')}`
}

/**
 * The venue's held seats, one entry per date and tee time. Rows must already
 * exclude cancelled and waitlisted seats; rows with no tee time are skipped.
 */
export function groupTeeTimes(rows: NoticeSeatRow[]): NoticeTeeTime[] {
  const groups = new Map<string, NoticeTeeTime & { firstAt: string }>()
  for (const row of rows) {
    if (!row.tee_time) continue
    const date = row.booking_date.slice(0, 10)
    const teeTime = normaliseTeeTime(row.tee_time)
    const key = `${date} ${teeTime}`
    const createdAt = row.created_at ?? ''
    let g = groups.get(key)
    if (!g) {
      g = { date, teeTime, players: 0, hostMemberId: null, firstBookerId: row.member_id, firstAt: createdAt }
      groups.set(key, g)
    }
    g.players++
    if (row.playing_host) g.hostMemberId = playingMemberId(row) ?? row.member_id
    if (createdAt && (!g.firstAt || createdAt < g.firstAt)) {
      g.firstAt = createdAt
      g.firstBookerId = row.member_id
    }
  }
  return [...groups.values()]
    .map(({ firstAt: _firstAt, ...g }) => g)
    .sort((a, b) => `${a.date} ${a.teeTime}`.localeCompare(`${b.date} ${b.teeTime}`))
}

/**
 * The tee times a club holds for us that no member has booked yet.
 *
 * Aviara holds our foursomes on its own tee sheet whether or not a member has
 * signed up (Greg, 2026-11-28: "the booking already exists on the Aviara tee
 * sheet, so we must notify them to release it"), and an empty one needs the
 * notice most. Until the community calendar replaces it, the app's record of
 * those foursomes is the tee times the venue's calendar offers members: a full
 * tee time drops out of the calendar and is in `booked` instead, so the two
 * together are what the club holds. Greg fills the earlier tee times first, so
 * on a busy day only the last one or two are short and those are the ones
 * notified; full ones never are.
 *
 * Some days the GHL calendar still offers an un-narrowed range (every 5 minutes
 * for two hours) rather than the tee times held. More tee times than the day's
 * cap can fill (`maxTeeTimes`) is read as such a range: a booked day then keeps
 * only its booked tee times, and an unbooked day takes the first — the club
 * holds at least that one.
 *
 * On a day nobody has booked, the playing host counts as a player in its first
 * tee time (Greg: "they just care that I am taking one of the 4 available
 * slots"); their seat isn't a booking row until the first member books. A day
 * the calendar offers nothing (taken off by an admin) has nothing held.
 *
 * `offered` is each date's calendar start times, offset-bearing ISO
 * ("2027-01-23T12:08:00-08:00") or 'HH:MM[:SS]'. Returns only the tee times
 * not already in `booked`.
 */
export function heldTeeTimes(
  booked: NoticeTeeTime[],
  offered: Record<string, string[]>,
  playingHostId: string | null,
  maxTeeTimes: number,
): NoticeTeeTime[] {
  const held: NoticeTeeTime[] = []
  for (const [date, starts] of Object.entries(offered)) {
    const bookedTimes = new Set(booked.filter(g => g.date === date).map(g => g.teeTime))
    const dayBooked = bookedTimes.size > 0
    const all = [...new Set(starts.map(clockOf).filter((t): t is string => !!t))].sort()
    const unbooked = all.filter(t => !bookedTimes.has(t))

    const isRange = new Set([...all, ...bookedTimes]).size > maxTeeTimes
    const picked = isRange ? (dayBooked ? [] : unbooked.slice(0, 1)) : unbooked

    picked.forEach((teeTime, i) => {
      const hostHere = !dayBooked && i === 0 && !!playingHostId
      held.push({
        date,
        teeTime,
        players: hostHere ? 1 : 0,
        hostMemberId: hostHere ? playingHostId : null,
        firstBookerId: playingHostId ?? '',
      })
    })
  }
  return held.sort((a, b) => `${a.date} ${a.teeTime}`.localeCompare(`${b.date} ${b.teeTime}`))
}

/** How many tee times a day's player cap can fill, a foursome to each. */
export function maxTeeTimesForCap(maxPlayersPerDay: number): number {
  return Math.max(1, Math.ceil(maxPlayersPerDay / FOURSOME))
}

export const FOURSOME = 4

/** 'HH:MM:SS' from an ISO start time or a bare clock time; null if neither. */
function clockOf(start: string): string | null {
  const m = /(?:T|^)(\d{1,2}:\d{2}(?::\d{2})?)/.exec(start)
  return m?.[1] ? normaliseTeeTime(m[1]) : null
}

/**
 * Whose name the notice gives: the host seated at that tee time, else the
 * venue's playing host (the club holds the foursome under their name), else
 * whoever booked it first.
 */
export function noticeHostId(group: NoticeTeeTime, venuePlayingHostId: string | null): string {
  return group.hostMemberId ?? venuePlayingHostId ?? group.firstBookerId
}

/** "Saturday, January 23, 2027" from 'YYYY-MM-DD', with no timezone involved. */
export function formatNoticeDate(date: string): string {
  const d = new Date(`${date.slice(0, 10)}T12:00:00Z`)
  return d.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

/** "12:08 PM" */
export function formatNoticeTime(teeTime: string): string {
  return formatTeeTime(teeTime).toUpperCase()
}

export interface NoticeValues {
  hostName: string
  date: string
  teeTime: string
  players: number
}

/** Slots left in the foursome. */
export function openSlots(players: number): number {
  return Math.max(0, FOURSOME - players)
}

/** The body with its placeholders filled. Placeholders match in any case. */
export function fillNoticeBody(template: string | null | undefined, v: NoticeValues): string {
  const body = template?.trim() ? template : DEFAULT_NOTICE_BODY
  const values: Record<string, string> = {
    'host name': v.hostName,
    'event date': formatNoticeDate(v.date),
    'tee time': formatNoticeTime(v.teeTime),
    'number of confirmed players': String(v.players),
    'open slots': String(openSlots(v.players)),
  }
  return body.replace(/\[([^\]]+)\]/g, (whole, name: string) => values[name.trim().toLowerCase()] ?? whole)
}

export function noticeSubject(venueName: string, v: NoticeValues): string {
  const open = openSlots(v.players)
  const slots = `${open} ${open === 1 ? 'slot' : 'slots'} open`
  return `LinkUp Golf at ${venueName}: ${formatNoticeDate(v.date)} at ${formatNoticeTime(v.teeTime)}, ${slots}`
}

/** Addresses from a comma-, semicolon- or space-separated list. Invalid ones are dropped. */
export function parseEmailList(value: string | null | undefined): string[] {
  if (!value) return []
  const out: string[] = []
  for (const part of value.split(/[\s,;]+/)) {
    const address = part.trim()
    if (address && EMAIL_RE.test(address) && !out.some(a => a.toLowerCase() === address.toLowerCase())) {
      out.push(address)
    }
  }
  return out
}

/** The entries of a list that aren't addresses — for the admin form's error. */
export function invalidEmails(value: string | null | undefined): string[] {
  if (!value) return []
  return value.split(/[\s,;]+/).map(p => p.trim()).filter(p => p && !EMAIL_RE.test(p))
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface NoticeRecipients {
  to: string[]
  cc: string[]
  /** True when this deployment held the club back and sent only the copy. */
  heldBack: boolean
}

/**
 * Who a notice goes to. Only production writes to the club: staging and local
 * development run against test bookings, and a test notice in a real golf
 * shop's inbox is the one mistake this feature can't take back. Anywhere else
 * the copy addresses receive it alone, and nobody does if there are none.
 */
export function noticeRecipients(to: string[], cc: string[], isProduction: boolean): NoticeRecipients {
  if (isProduction) return { to, cc: cc.filter(a => !to.includes(a)), heldBack: false }
  return { to: cc, cc: [], heldBack: true }
}

/** The production app's address. Anything else is a test deployment. */
export const PRODUCTION_APP_URL = 'https://app.linkup.golf'

export function isProductionApp(appUrl: string | undefined): boolean {
  return (appUrl ?? '').replace(/\/+$/, '').toLowerCase() === PRODUCTION_APP_URL
}

/** A form value for the hours or threshold, or null if it isn't one. */
export function parseNoticeNumber(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max ? n : null
}
