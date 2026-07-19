import { describe, it, expect } from 'vitest'
import { parseReferralLines } from '@/lib/referral-parse'

describe('parseReferralLines', () => {
  it('reads a bare email address', () => {
    expect(parseReferralLines('jane@example.com')).toEqual([
      { email: 'jane@example.com', name: null },
    ])
  })

  it('reads the "Name <email>" form', () => {
    expect(parseReferralLines('Jane Smith <jane@example.com>')).toEqual([
      { email: 'jane@example.com', name: 'Jane Smith' },
    ])
  })

  it('reads comma-separated name and email in either order', () => {
    expect(parseReferralLines('Priya Patel, priya@example.com')).toEqual([
      { email: 'priya@example.com', name: 'Priya Patel' },
    ])
    expect(parseReferralLines('mark@example.com, Mark Lee')).toEqual([
      { email: 'mark@example.com', name: 'Mark Lee' },
    ])
  })

  it('handles a multi-line paste of mixed formats', () => {
    const rows = parseReferralLines(
      'Jane Smith <jane@example.com>\nmark@example.com\nPriya Patel, priya@example.com'
    )
    expect(rows).toEqual([
      { email: 'jane@example.com', name: 'Jane Smith' },
      { email: 'mark@example.com', name: null },
      { email: 'priya@example.com', name: 'Priya Patel' },
    ])
  })

  it('lowercases addresses so they match how links are stored', () => {
    expect(parseReferralLines('Jane <JANE@Example.COM>')[0]?.email).toBe('jane@example.com')
  })

  it('drops duplicate addresses, keeping the first', () => {
    const rows = parseReferralLines('Jane Smith <jane@example.com>\njane@example.com')
    expect(rows).toEqual([{ email: 'jane@example.com', name: 'Jane Smith' }])
  })

  it('treats casing differences as the same address', () => {
    expect(parseReferralLines('jane@example.com\nJANE@EXAMPLE.COM')).toHaveLength(1)
  })

  it('skips blank lines and lines with no address', () => {
    expect(parseReferralLines('\n\nsome heading\n\njane@example.com\n  \n')).toEqual([
      { email: 'jane@example.com', name: null },
    ])
  })

  it('collapses whitespace in names', () => {
    expect(parseReferralLines('Jane    Smith   <jane@example.com>')[0]?.name).toBe('Jane Smith')
  })

  it('handles CRLF line endings from spreadsheet pastes', () => {
    expect(parseReferralLines('a@x.com\r\nb@x.com')).toHaveLength(2)
  })

  it('returns nothing for empty input', () => {
    expect(parseReferralLines('')).toEqual([])
    expect(parseReferralLines('   \n  ')).toEqual([])
  })
})
