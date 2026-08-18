// A stable colour per venue, so the same club reads the same everywhere it
// appears in a calendar — dots on mobile, name chips on wider screens, and the
// legend all share one index.
//
// Shared by the hosted-events calendar and the /book availability calendar so
// the two never drift into different palettes.

export const VENUE_DOT = [
  'bg-emerald-500', 'bg-sky-500', 'bg-violet-500', 'bg-orange-500',
  'bg-rose-500', 'bg-teal-500', 'bg-indigo-500', 'bg-fuchsia-500',
] as const

export const VENUE_TEXT = [
  'text-emerald-700', 'text-sky-700', 'text-violet-700', 'text-orange-700',
  'text-rose-700', 'text-teal-700', 'text-indigo-700', 'text-fuchsia-700',
] as const

// Tinted chip backgrounds, for the wider-screen day cells where a venue's name
// sits on its own pill rather than beside a dot.
export const VENUE_CHIP = [
  'bg-emerald-50 border-emerald-200', 'bg-sky-50 border-sky-200',
  'bg-violet-50 border-violet-200', 'bg-orange-50 border-orange-200',
  'bg-rose-50 border-rose-200', 'bg-teal-50 border-teal-200',
  'bg-indigo-50 border-indigo-200', 'bg-fuchsia-50 border-fuchsia-200',
] as const

export const VENUE_COLOUR_COUNT = VENUE_DOT.length

/** Colour index for a venue, assigned in the order ids are handed in. */
export function buildVenueColours(ids: Iterable<string>): Map<string, number> {
  const byId = new Map<string, number>()
  for (const id of ids) {
    if (!byId.has(id)) byId.set(id, byId.size % VENUE_COLOUR_COUNT)
  }
  return byId
}
