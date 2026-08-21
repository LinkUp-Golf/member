// The shape of the become-a-host form, and the one function that turns it into
// a request body.
//
// Extracted from the page so this seam can be tested. It is where the form's
// own vocabulary (a list of venue cards, each with a round) is translated into
// the API's (`course_ids` and `events` referencing a venue) — and a translation
// nobody can see is how a whole field once got dropped between the form and the
// request without anything failing.

import type { HostApplicationEventInput } from '@/types'

export const NAME_MIN = 2
export const NAME_MAX = 120
export const TEE_TIME_MAX = 50
export const SPOTS_MIN = 1
export const SPOTS_MAX = 200
/** Matches the CHECK on host_application_events.member_guest_rate. */
export const RATE_MAX = 100000
export const DEFAULT_SPOTS = '3'
export const MAX_DATES_PER_ROUND = 30

/** A round as submitted: `venue` is the course id it sits at. */
export type ProposedRound = Omit<HostApplicationEventInput, 'course_id'> & {
  venue: string
}

export type SubmitValues = {
  name: string
  course_ids: string[]
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

export interface ApplicationValues {
  name: string
  existing: ExistingVenueField[]
}

/**
 * Only one kind of venue now: a course already on LinkUp. Applicants could once
 * name a club we didn't have, which created a pending course on submission —
 * hosting is offered at listed venues only, so that kind is gone. The union is
 * kept so `roundAt` still reads as a lookup by kind rather than a bare field.
 */
export type VenueKind = 'existing'

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

  return {
    name: data.name.trim(),
    course_ids: data.existing.map(v => v.courseId),
    events,
  }
}
