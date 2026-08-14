// The shape of the become-a-host form, and the one function that turns it into
// a request body.
//
// Extracted from the page so this seam can be tested. It is where the form's
// own vocabulary (a list of venue cards, each with a round) is translated into
// the API's (`course_ids`, `new_venues`, and `events` referencing a new venue by
// its position) — and a translation nobody can see is how `new_venues` once got
// dropped between the form and the request without anything failing.

import { NEW_VENUE_REF } from '@/lib/validation'
import type { HostApplicationEventInput } from '@/types'

export const NAME_MIN = 2
export const NAME_MAX = 120
export const CLUB_NAME_MIN = 2
export const CLUB_NAME_MAX = 120
export const WEBSITE_MAX = 200
export const TEE_TIME_MAX = 50
export const SPOTS_MIN = 1
export const SPOTS_MAX = 200
/** Matches the CHECK on host_application_events.member_guest_rate. */
export const RATE_MAX = 100000
export const DEFAULT_SPOTS = '3'
export const MAX_DATES_PER_ROUND = 30
export const MAX_CUSTOM_VENUES = 10

/** A round as submitted: `venue` is a course id or a `new:<index>` reference. */
export type ProposedRound = Omit<HostApplicationEventInput, 'course_id'> & {
  venue: string
}

export type SubmitValues = {
  name: string
  course_ids: string[]
  new_venues: { name: string; website: string | null }[]
  events: ProposedRound[]
}

/**
 * The round a venue would host.
 *
 * Dates are wrapped in objects because useFieldArray keys rows by identity, and
 * a bare string list has none. Everything else is a string because these are raw
 * inputs — an empty numeric field is "" and must stay distinguishable from 0,
 * which is a legitimate guest rate.
 *
 * Several dates on one round become one event each, sharing the tee time, spots,
 * rate and dinner. That's why a venue needs only one round: two rounds at the
 * same club were only ever two dates.
 */
export interface RoundFields {
  dates: { value: string }[]
  tee_time: string
  total_spots: string
  member_guest_rate: string
  dinner: boolean
}

/**
 * A venue already on LinkUp that the applicant ticked. `courseId`, not `id` —
 * useFieldArray claims `id` for its own row keys and would overwrite it.
 */
export interface ExistingVenueField {
  courseId: string
  label: string
  pending: boolean
  round: RoundFields
}

/**
 * A club the applicant named that isn't on LinkUp yet. Held in form state only —
 * the pending course is created when the application is submitted, so abandoning
 * the form leaves nothing behind in the admin queue.
 */
export interface CustomVenueField {
  name: string
  website: string
  round: RoundFields
}

export interface ApplicationValues {
  name: string
  existing: ExistingVenueField[]
  custom: CustomVenueField[]
}

export type VenueKind = 'existing' | 'custom'

export const newRound = (): RoundFields => ({
  dates: [{ value: '' }],
  tee_time: '',
  total_spots: DEFAULT_SPOTS,
  member_guest_rate: '',
  dinner: false,
})

/**
 * Has the applicant started filling this round in? Rounds stay optional — you
 * can name the clubs you want and supply dates later — so an untouched one is
 * skipped rather than failing validation. total_spots is excluded because it
 * carries a default nobody chose.
 */
export const roundStarted = (r: RoundFields | undefined): boolean =>
  !!r &&
  (r.dates.some(d => d.value.trim() !== '') ||
    r.tee_time.trim() !== '' ||
    r.member_guest_rate.trim() !== '' ||
    r.dinner)

/**
 * The round a field belongs to, read out of the whole-form values react-hook-form
 * hands every `validate`. Going through the form values rather than a captured
 * closure keeps each rule reading the state at validation time, not at render.
 */
export const roundAt = (
  values: ApplicationValues,
  kind: VenueKind,
  index: number,
): RoundFields | undefined => values[kind]?.[index]?.round

/**
 * Turns validated form values into the request body. No validation happens here:
 * by the time handleSubmit calls this, every field rule has passed.
 *
 * The ordering of `custom` is load-bearing — an event at a club that doesn't
 * exist yet names it by its index in `new_venues`, and the server resolves the
 * two together.
 */
export function buildApplicationPayload(data: ApplicationValues): SubmitValues {
  const events: ProposedRound[] = []

  const collect = (round: RoundFields, venue: string) => {
    if (!roundStarted(round)) return
    const dates = round.dates.map(d => d.value.trim()).filter(Boolean)
    for (const date of dates) {
      events.push({
        venue,
        event_date: date,
        tee_time: round.tee_time.trim() || null,
        total_spots: Number(round.total_spots),
        member_guest_rate: Number(round.member_guest_rate),
        dinner: round.dinner,
      })
    }
  }

  data.existing.forEach(v => collect(v.round, v.courseId))
  data.custom.forEach((v, i) => collect(v.round, `${NEW_VENUE_REF}${i}`))

  return {
    name: data.name.trim(),
    course_ids: data.existing.map(v => v.courseId),
    new_venues: data.custom.map(v => ({
      name: v.name.trim(),
      website: v.website.trim() || null,
    })),
    events,
  }
}
