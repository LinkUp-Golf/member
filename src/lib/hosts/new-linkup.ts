// A "New LinkUp" — a host proposing rounds at a club we don't have yet.
//
// Asked in two places that must ask it the same way: the New LinkUp tab of the
// host's event drawer, and the become-a-host application, where it replaced
// the bare "add a club we don't have yet" box. Both hold these values, check
// them with validateNewLinkup, and turn them into rounds with newLinkupRounds.
//
// There's no calendar behind a club we haven't set up, so nothing here can be
// read from one: the host names the club, picks real dates (each with its own
// tee time), and says how many guests it takes and at what rate. Everything but
// the website is required — it's the whole of what we'll have to work from.

import { DEFAULT_PAYMENT_OPTIONS, type PaymentOption } from '@/lib/bookings/payment-options'

export const NEW_LINKUP_NAME_MIN = 2
export const NEW_LINKUP_NAME_MAX = 120
export const NEW_LINKUP_WEBSITE_MAX = 200
export const NEW_LINKUP_GUESTS_MAX = 200

export interface NewLinkupValues {
  /** The event/club being proposed. */
  name: string
  /** Optional — the one field that is. */
  website: string
  /** YYYY-MM-DD, one event each. */
  dates: string[]
  /** date → tee time as typed; '' is no fixed time. */
  teeTimes: Record<string, string>
  /** Number of guests a day, as typed. */
  guests: string
  /** Member guest rate, as typed. */
  rate: string
  /** How members pay at the club — written onto the pending course. */
  paymentOptions: PaymentOption[]
}

export type NewLinkupField = 'name' | 'website' | 'dates' | 'guests' | 'rate'
export type NewLinkupErrors = Partial<Record<NewLinkupField, string>>

export const emptyNewLinkup = (): NewLinkupValues => ({
  name: '',
  website: '',
  dates: [],
  teeTimes: {},
  guests: '',
  rate: '',
  paymentOptions: [...DEFAULT_PAYMENT_OPTIONS],
})

/**
 * Has anything been filled in? On the application a New LinkUp is optional, so
 * one left untouched is skipped rather than failing validation. Payment options
 * don't count — they start filled.
 */
export const newLinkupStarted = (v: NewLinkupValues): boolean =>
  v.name.trim() !== '' ||
  v.website.trim() !== '' ||
  v.dates.length > 0 ||
  v.guests.trim() !== '' ||
  v.rate.trim() !== '' ||
  Object.values(v.teeTimes).some(t => t.trim() !== '')

/** Field-by-field errors; an empty object means it's good to send. */
export function validateNewLinkup(v: NewLinkupValues): NewLinkupErrors {
  const errors: NewLinkupErrors = {}

  const name = v.name.trim()
  if (name.length < NEW_LINKUP_NAME_MIN) errors.name = 'Enter the event name'
  else if (name.length > NEW_LINKUP_NAME_MAX) errors.name = `At most ${NEW_LINKUP_NAME_MAX} characters`

  const website = v.website.trim()
  if (website && !/^https?:\/\/.+/i.test(website)) errors.website = 'Website must start with https://'
  else if (website.length > NEW_LINKUP_WEBSITE_MAX) errors.website = `At most ${NEW_LINKUP_WEBSITE_MAX} characters`

  if (v.dates.length === 0) errors.dates = 'Pick the dates you want to host.'

  const guests = Number(v.guests)
  if (v.guests.trim() === '' || !Number.isInteger(guests) || guests < 1 || guests > NEW_LINKUP_GUESTS_MAX) {
    errors.guests = `A whole number between 1 and ${NEW_LINKUP_GUESTS_MAX}`
  }

  const rate = Number(v.rate)
  if (v.rate.trim() === '' || !Number.isFinite(rate) || rate < 0) errors.rate = '0 or more'

  return errors
}

export const hasNewLinkupErrors = (errors: NewLinkupErrors) => Object.keys(errors).length > 0

/** One round per date, in date order, carrying the host's own spots and rate. */
export function newLinkupRounds(v: NewLinkupValues): {
  event_date: string
  tee_time: string | null
  total_spots: number
  member_guest_rate: number
  dinner: boolean
}[] {
  return [...v.dates].sort().map(date => ({
    event_date: date,
    tee_time: (v.teeTimes[date] ?? '').trim() || null,
    total_spots: Number(v.guests),
    member_guest_rate: Number(v.rate),
    dinner: false,
  }))
}
