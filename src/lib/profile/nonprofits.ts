// Parsing for the non-profits a member supports.
//
// Three callers need the same cleaning rules and must agree, or the same
// person's list looks different depending on how it arrived:
//   - the profile API, where a member typed it one per line,
//   - the GHL sync, where it comes off contact.nonprofits as one string,
//   - the popularity report, which counts entries and would double-count
//     'Red Cross' against 'red cross '.
//
// So the rules live here rather than at each call site.

export const MAX_NONPROFITS = 3

/** Per entry. Comfortably fits a real charity name; the DB caps the joined length at 400. */
export const MAX_NONPROFIT_LENGTH = 120

/**
 * Clean a per-line list into individual entries: split on newlines, trim,
 * drop blanks, drop case-insensitive duplicates, truncate anything absurd.
 *
 * NOT capped at MAX_NONPROFITS — the caller decides what over-length means.
 * A member typing four lines should be told, not silently have the fourth
 * deleted; a GHL contact carrying four is a value we don't control and can
 * only truncate. Same parse, different policy.
 *
 * Deduping is case-insensitive but keeps the first spelling the member used,
 * so their own capitalisation survives.
 */
export function parseNonprofits(input: string | string[] | null | undefined): string[] {
  if (input == null) return []

  const lines = Array.isArray(input) ? input : input.split(/\r?\n/)
  const seen = new Set<string>()
  const out: string[] = []

  for (const line of lines) {
    if (typeof line !== 'string') continue
    const value = line.trim().slice(0, MAX_NONPROFIT_LENGTH).trim()
    if (!value) continue
    const key = value.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(value)
  }

  return out
}

/** Back to textarea form, for editing. */
export function formatNonprofits(values: string[] | null | undefined): string {
  return (values ?? []).join('\n')
}

/**
 * Does this list contain a non-profit matching the query? Case-insensitive
 * substring, so "boys" finds "Boys & Girls Club" — admin search is a lookup,
 * not an exact match.
 */
export function matchesNonprofit(values: string[] | null | undefined, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  return (values ?? []).some(v => v.toLowerCase().includes(q))
}
