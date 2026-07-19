// ============================================================
// LinkUp Golf — CSV parsing for referral list uploads
// Pure and isomorphic: the partner's browser validates a file before upload so
// mistakes are caught immediately, and the server re-validates the same way
// because client-side checks are a convenience, never a guarantee.
//
// Handles the parts of RFC 4180 that real exports produce: quoted fields,
// embedded commas and newlines, doubled quotes as an escape, CRLF endings, and
// a UTF-8 BOM (which Excel writes and which would otherwise corrupt the first
// header name).
// ============================================================

/** Column headers a referral list must provide, in any order or casing. */
export const REQUIRED_COLUMNS = ['name', 'email'] as const

export interface CsvParseResult {
  header: string[]
  rows: string[][]
}

/** Split raw CSV text into a header row and data rows. */
export function parseCsv(text: string): CsvParseResult {
  // Strip the BOM: Excel prepends it, and it would become part of the first
  // header name, so "name" would silently fail to match.
  const input = text.replace(/^﻿/, '')

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < input.length; i++) {
    const char = input[i]

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (input[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else {
        field += char
      }
      continue
    }

    if (char === '"') { inQuotes = true; continue }

    if (char === ',') { row.push(field); field = ''; continue }

    if (char === '\n' || char === '\r') {
      // Swallow the \n of a \r\n pair so it doesn't open an empty row.
      if (char === '\r' && input[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      continue
    }

    field += char
  }

  // Trailing field/row when the file doesn't end in a newline.
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }

  // Drop rows that are entirely empty (trailing blank lines).
  const nonEmpty = rows.filter(r => r.some(cell => cell.trim().length > 0))
  if (!nonEmpty.length) return { header: [], rows: [] }

  const [header, ...data] = nonEmpty
  return {
    header: (header ?? []).map(h => h.trim()),
    rows: data,
  }
}

export interface ReferralCsvRow {
  /** Always present — an empty name fails validation. */
  name: string
  email: string
  /** 1-based line number in the file, counting the header — for error messages. */
  line: number
}

export interface ReferralCsvResult {
  valid: boolean
  /**
   * Everything wrong with the file. All of it blocks submission — a row with
   * a missing name, a missing address, a malformed address, or a duplicate is
   * rejected rather than quietly dropped, so the partner fixes their file
   * instead of discovering later that people they listed never made it in.
   */
  errors: string[]
  rows: ReferralCsvRow[]
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Validate an uploaded referral list and extract its rows.
 *
 * Strict by design: the file must carry a header naming both required columns,
 * and every row must have a non-empty name and a valid email address. Anything
 * else fails the whole file. Silently skipping bad rows would mean a partner
 * submits 50 referrals, 6 vanish, and nobody notices until commission is short.
 */
export function parseReferralCsv(text: string): ReferralCsvResult {
  const errors: string[] = []

  const { header, rows } = parseCsv(text)

  if (!header.length) {
    return { valid: false, errors: ['That file is empty.'], rows: [] }
  }

  const normalised = header.map(h => h.trim().toLowerCase())
  const missing = REQUIRED_COLUMNS.filter(c => !normalised.includes(c))

  if (missing.length) {
    errors.push(
      `The file is missing the ${missing.map(m => `"${m}"`).join(' and ')} ` +
      `column${missing.length > 1 ? 's' : ''}. Found: ${header.length ? header.join(', ') : 'nothing'}. ` +
      `The first row must be a header with "name" and "email" columns.`
    )
    return { valid: false, errors, rows: [] }
  }

  const nameIdx = normalised.indexOf('name')
  const emailIdx = normalised.indexOf('email')

  const seenAt = new Map<string, number>()
  const parsed: ReferralCsvRow[] = []

  rows.forEach((cells, i) => {
    const line = i + 2 // +1 for the header, +1 for 1-based counting
    const email = (cells[emailIdx] ?? '').trim().toLowerCase()
    const name = (cells[nameIdx] ?? '').trim()

    // Report every problem on the row, so one pass through the file surfaces
    // everything the partner needs to fix.
    if (!name) errors.push(`Line ${line}: the name is empty.`)

    if (!email) {
      errors.push(`Line ${line}: the email is empty.`)
    } else if (!EMAIL_RE.test(email)) {
      errors.push(`Line ${line}: "${email}" is not a valid email address.`)
    } else {
      const first = seenAt.get(email)
      if (first !== undefined) {
        errors.push(`Line ${line}: "${email}" is already on line ${first}.`)
      } else {
        seenAt.set(email, line)
        if (name) parsed.push({ email, name, line })
      }
    }
  })

  if (!rows.length) {
    errors.push('That file has a header but no referrals.')
  }

  return { valid: errors.length === 0, errors, rows: errors.length ? [] : parsed }
}

/** Render rows back to CSV, for the admin's download of a submitted list. */
export function toCsv(header: string[], rows: Array<Array<string | null>>): string {
  const escape = (value: string | null) => {
    const v = value ?? ''
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  }
  return [header, ...rows].map(r => r.map(escape).join(',')).join('\r\n')
}
