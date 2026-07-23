import { describe, it, expect } from 'vitest'
import { parseCsv, parseReferralCsv, toCsv } from '@/lib/csv'

describe('parseCsv', () => {
  it('splits a simple file into header and rows', () => {
    expect(parseCsv('name,email\nJane,jane@x.com')).toEqual({
      header: ['name', 'email'],
      rows: [['Jane', 'jane@x.com']],
    })
  })

  it('handles CRLF endings', () => {
    expect(parseCsv('name,email\r\nJane,jane@x.com\r\n').rows).toEqual([['Jane', 'jane@x.com']])
  })

  it('strips the UTF-8 BOM Excel writes', () => {
    // Left in place, the BOM becomes part of the first header name.
    expect(parseCsv('﻿name,email\nJane,jane@x.com').header).toEqual(['name', 'email'])
  })

  it('respects quoted fields containing commas', () => {
    expect(parseCsv('name,email\n"Smith, Jane",jane@x.com').rows).toEqual([
      ['Smith, Jane', 'jane@x.com'],
    ])
  })

  it('unescapes doubled quotes', () => {
    expect(parseCsv('name,email\n"Jane ""JJ"" Smith",jane@x.com').rows).toEqual([
      ['Jane "JJ" Smith', 'jane@x.com'],
    ])
  })

  it('allows newlines inside quoted fields', () => {
    expect(parseCsv('name,email\n"Jane\nSmith",jane@x.com').rows).toEqual([
      ['Jane\nSmith', 'jane@x.com'],
    ])
  })

  it('ignores trailing blank lines', () => {
    expect(parseCsv('name,email\nJane,jane@x.com\n\n\n').rows).toHaveLength(1)
  })

  it('handles a final row with no trailing newline', () => {
    expect(parseCsv('name,email\nJane,jane@x.com').rows).toHaveLength(1)
  })

  it('returns empty for empty input', () => {
    expect(parseCsv('')).toEqual({ header: [], rows: [] })
    expect(parseCsv('\n\n')).toEqual({ header: [], rows: [] })
  })
})

describe('parseReferralCsv', () => {
  it('accepts a well-formed file', () => {
    const result = parseReferralCsv('name,email\nJane Smith,jane@x.com\nMark Lee,mark@x.com')
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.rows).toEqual([
      { name: 'Jane Smith', email: 'jane@x.com', line: 2 },
      { name: 'Mark Lee', email: 'mark@x.com', line: 3 },
    ])
  })

  it('ignores extra columns beyond name and email', () => {
    const result = parseReferralCsv('name,phone,email\nJane,555,jane@x.com')
    expect(result.valid).toBe(true)
    expect(result.rows[0]).toEqual({ name: 'Jane', email: 'jane@x.com', line: 2 })
  })

  it('accepts headers in any order or casing', () => {
    const result = parseReferralCsv('Email,NAME\njane@x.com,Jane Smith')
    expect(result.valid).toBe(true)
    expect(result.rows[0]).toEqual({ name: 'Jane Smith', email: 'jane@x.com', line: 2 })
  })

  it('rejects a file missing the email column', () => {
    const result = parseReferralCsv('name,phone\nJane,555')
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('"email"')
    expect(result.rows).toEqual([])
  })

  it('rejects a file missing the name column', () => {
    const result = parseReferralCsv('email\njane@x.com')
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('"name"')
  })

  it('names both columns when both are missing', () => {
    const result = parseReferralCsv('foo,bar\n1,2')
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('"name"')
    expect(result.errors[0]).toContain('"email"')
  })

  it('rejects an empty file', () => {
    expect(parseReferralCsv('').valid).toBe(false)
  })

  it('lowercases addresses to match how links are stored', () => {
    expect(parseReferralCsv('name,email\nJane,JANE@X.COM').rows[0]?.email).toBe('jane@x.com')
  })

  // Bad rows block the whole upload rather than being silently dropped —
  // otherwise a partner submits 50 referrals, some vanish, and nobody notices
  // until their commission is short.

  it('rejects the file when a row has a malformed address', () => {
    const result = parseReferralCsv('name,email\nJane,jane@x.com\nBroken,not-an-email')
    expect(result.valid).toBe(false)
    expect(result.rows).toEqual([])
    expect(result.errors[0]).toContain('Line 3')
    expect(result.errors[0]).toContain('not a valid email')
  })

  it('rejects the file when a name is empty', () => {
    const result = parseReferralCsv('name,email\n,jane@x.com')
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Line 2')
    expect(result.errors[0]).toContain('name is empty')
  })

  it('rejects the file when an email is empty', () => {
    const result = parseReferralCsv('name,email\nJane,')
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('email is empty')
  })

  it('rejects a duplicate address and points at the first occurrence', () => {
    const result = parseReferralCsv('name,email\nJane,jane@x.com\nJane Again,JANE@x.com')
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('Line 3')
    expect(result.errors[0]).toContain('already on line 2')
  })

  it('reports every problem on a row at once so one pass fixes the file', () => {
    const result = parseReferralCsv('name,email\n,bad\nMark,mark@x.com')
    expect(result.valid).toBe(false)
    // One row, two distinct faults — both surfaced rather than stopping at the first.
    expect(result.errors).toEqual([
      'Line 2: the name is empty.',
      'Line 2: "bad" is not a valid email address.',
    ])
  })

  it('ignores a wholly empty trailing row rather than calling it invalid', () => {
    // Spreadsheet exports routinely end with a bare ",".
    const result = parseReferralCsv('name,email\nJane,jane@x.com\n,')
    expect(result.valid).toBe(true)
    expect(result.rows).toHaveLength(1)
  })

  it('rejects a header with no rows beneath it', () => {
    const result = parseReferralCsv('name,email')
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain('no referrals')
  })

  it('reports line numbers that match the file as the user sees it', () => {
    const result = parseReferralCsv('name,email\nA,a@x.com\nB,bad\nC,c@x.com')
    // Header is line 1, so the bad row is line 3.
    expect(result.errors[0]).toContain('Line 3')
  })

  it('numbers lines correctly when a quoted field spans multiple lines', () => {
    const result = parseReferralCsv('name,email\n"Jane\nSmith",jane@x.com\nMark,bad')
    // The quoted newline is one row, so the bad row is the third CSV record.
    expect(result.errors[0]).toContain('Line 3')
  })
})

describe('toCsv', () => {
  it('round-trips through parseCsv', () => {
    const csv = toCsv(['name', 'email'], [['Jane', 'jane@x.com']])
    expect(parseCsv(csv).rows).toEqual([['Jane', 'jane@x.com']])
  })

  it('quotes fields containing commas, quotes, or newlines', () => {
    const csv = toCsv(['name', 'email'], [['Smith, Jane', 'jane@x.com']])
    expect(csv).toContain('"Smith, Jane"')
    expect(parseCsv(csv).rows[0]?.[0]).toBe('Smith, Jane')
  })

  it('renders a null cell as empty', () => {
    expect(toCsv(['name', 'email'], [[null, 'jane@x.com']])).toBe('name,email\r\n,jane@x.com')
  })
})
