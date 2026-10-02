import { describe, it, expect } from 'vitest'
import { nameOrEmail, titleCaseName } from '@/lib/utils'

// What to call someone, given whatever we hold for them.
//
// Every list of people in the app used to print the word "Member" for anyone
// with no name on their member row — and a member can genuinely have none, since
// a non-member guest is provisioned from an address and a phone number. Four
// rows reading "Member" are four people the reader can't tell apart, and one of
// them might be the one they're looking for.

describe('nameOrEmail', () => {
  it('prefers the name, title-cased', () => {
    expect(nameOrEmail('dana okafor', 'dana@example.com')).toBe('Dana Okafor')
  })

  it('falls back to the address when there is no name', () => {
    expect(nameOrEmail('', 'dana@example.com')).toBe('dana@example.com')
    expect(nameOrEmail(null, 'dana@example.com')).toBe('dana@example.com')
    expect(nameOrEmail(undefined, 'dana@example.com')).toBe('dana@example.com')
    // One half of a name is still a name.
    expect(nameOrEmail('dana', 'dana@example.com')).toBe('Dana')
  })

  it('treats whitespace as no name at all', () => {
    // `${first} ${last}` on two empty columns is a single space, which is what
    // every caller actually passes in this case.
    expect(nameOrEmail('   ', 'dana@example.com')).toBe('dana@example.com')
    expect(nameOrEmail(' ', 'dana@example.com')).toBe('dana@example.com')
  })

  it('leaves an address exactly as it is', () => {
    // An address is not a name: title-casing it would both look wrong and stop
    // it being recognised. Compare what titleCaseName would have done to it.
    expect(nameOrEmail('', 'dana.okafor@example.com')).toBe('dana.okafor@example.com')
    expect(titleCaseName('dana.okafor@example.com')).toBe('Dana.okafor@example.com')
  })

  it('trims the address', () => {
    expect(nameOrEmail(null, '  dana@example.com  ')).toBe('dana@example.com')
  })

  it('answers nothing when we hold neither, so the caller can say its own word', () => {
    // "Member", "Booker", "Host" — the last resort belongs to the list, not here.
    expect(nameOrEmail('', null)).toBe('')
    expect(nameOrEmail(null)).toBe('')
    expect(nameOrEmail('  ', '   ')).toBe('')
  })
})
