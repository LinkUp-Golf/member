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
 * a bare string list has none.
 *
 * Spots and the guest rate are deliberately absent, matching the host's own
 * event form: capacity is whatever the venue has open on the day (the number the
 * date picker already shows on each chip) and the rate is a fixed term, so
 * neither was ever the applicant's to type. The server sets both — see POST
 * /api/host/application — which is why asking for them here produced two numbers
 * that were collected, validated, and then thrown away.
 *
 * Several dates on one round become one event each, sharing the tee time and
 * dinner setting. That's why a venue needs only one round: two rounds at the
 * same club were only ever two dates.
 */
export interface RoundFields {
  dates: { value: string }[]
  tee_time: string
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
 * One kind of venue: a course that already exists. Naming a club we don't have
 * is possible again (AddVenueControl), but it creates the pending course before
 * the application is submitted rather than as part of submitting it — so by the
 * time this payload is built there is no second kind, only a course id whose
 * course happens to be pending. That's what lets the server insist on a real id.
 *
 * The union is kept so `roundAt` still reads as a lookup by kind rather than a
 * bare field.
 */
export type VenueKind = 'existing'

export const newRound = (): RoundFields => ({
  dates: [{ value: '' }],
  tee_time: '',
  dinner: false,
})

/**
 * Has the applicant started filling this round in? Rounds stay optional — you
 * can name the clubs you want and supply dates later — so an untouched one is
 * skipped rather than failing validation. Every field left is one the applicant
 * chose, so any of them being set counts.
 */
export const roundStarted = (r: RoundFields | undefined): boolean =>
  !!r &&
  (r.dates.some(d => d.value.trim() !== '') ||
    r.tee_time.trim() !== '' ||
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
