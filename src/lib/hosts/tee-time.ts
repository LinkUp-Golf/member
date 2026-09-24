// A hosted round's tee time.
//
// It used to be free text — a host typed "8:30 AM" or "Shotgun 9am" — which is
// why the column is text rather than `time` (20260723000001_hosted_event_free_
// text_tee_time.sql). It's now picked with <input type="time">, so what a host
// sends is a clock value, and every date they pick has to carry one: a date
// listed with no time is a round nobody can turn up to.
//
// Rows written before this still read fine — formatEventTeeTime shows anything
// that isn't a clock value exactly as it was written. They just can't be saved
// again without setting a real time, which is what normaliseTeeTime makes
// visible: the input can't display "Shotgun 9am", so it shows as unset.
//
// Dependency-free on purpose: the input, the two host forms' rules and the
// route that accepts them all read it, and they must agree on the format.

/** "HH:MM", with an optional leading zero and optional seconds (legacy rows). */
const CLOCK_RE = /^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/

/** Said the same way wherever a date is missing its time. */
export const TEE_TIME_REQUIRED = 'Set a tee time for every date'

/**
 * What a newly picked date tees off at until the host says otherwise.
 *
 * Hosted rounds go off in the early afternoon, and a host listing a week of
 * dates was typing the same time seven times. Pre-filled rather than assumed:
 * it lands in the time input as a real value, so changing it is one tap and
 * leaving it is a choice rather than a blank that fails validation.
 */
export const DEFAULT_TEE_TIME = '13:30'

/** Whether this is a time of day we can store and show. */
export const isTeeTime = (value: unknown): value is string =>
  typeof value === 'string' && CLOCK_RE.test(value.trim())

/**
 * A clock value in the form <input type="time"> both emits and accepts —
 * "HH:MM", zero-padded, seconds dropped. '' for anything else, including a
 * legacy free-text time: the input has no way to show it, so it reads as unset
 * and has to be picked again.
 */
export function normaliseTeeTime(value: unknown): string {
  if (!isTeeTime(value)) return ''
  const [hours = '', minutes = ''] = value.trim().split(':')
  return `${hours.padStart(2, '0')}:${minutes}`
}

/** The picked dates still missing a tee time — empty when every one has one. */
export function missingTeeTimes(
  dates: string[],
  teeTimes: Record<string, string> | null | undefined,
): string[] {
  return dates.filter(date => !isTeeTime(teeTimes?.[date]))
}
