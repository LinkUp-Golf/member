// ============================================================
// LinkUp Golf — Parsing a pasted referral list
// Pure and isomorphic. Partners paste from address books, spreadsheets, and
// email clients, so rather than demanding a format we find the email address
// on each line by pattern and treat whatever else is there as the name.
//
// Handles: "Jane Smith <jane@x.com>", "jane@x.com", "Priya Patel, priya@x.com".
// ============================================================

const EMAIL_RE = /[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+/

export interface ParsedReferral {
  email: string
  name: string | null
}

export function parseReferralLines(text: string): ParsedReferral[] {
  const seen = new Set<string>()
  const rows: ParsedReferral[] = []

  for (const line of text.split(/[\n\r]+/)) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const match = trimmed.match(EMAIL_RE)
    if (!match) continue

    // Lowercased to match how link rows store addresses — that's what makes
    // the duplicate check here and the attribution lookup on import agree.
    const email = match[0].toLowerCase()
    if (seen.has(email)) continue
    seen.add(email)

    const name = trimmed
      .replace(match[0], '')
      .replace(/[<>,;]/g, ' ')
      .trim()
      .replace(/\s+/g, ' ')

    rows.push({ email, name: name || null })
  }

  return rows
}
