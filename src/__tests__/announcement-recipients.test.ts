import { describe, it, expect } from 'vitest'
import {
  NOBODY,
  namesNobody,
  memberTags,
  membersCarryingAnyTag,
  normaliseAudience,
} from '@/lib/announcements/recipients'

// An announcement's email audience. The failure that matters is silent: an
// admin narrows the list, the tags don't match the way they thought, and either
// the wrong people get mail or nobody does — and either way the send has already
// happened by the time anyone could look.

describe('normaliseAudience', () => {
  it('keeps what was chosen and drops what wasn\'t', () => {
    expect(
      normaliseAudience({ tags: [' vip ', 'vip', '', '  '], memberIds: ['a', 'a', 'b'] }),
    ).toEqual({ tags: ['vip'], memberIds: ['a', 'b'] })
  })

  it('keeps a tag\'s own spelling, because that is what gets read back', () => {
    // Matching normalises; storing doesn't. An admin who picked 'Member-Active-SD'
    // should see 'Member-Active-SD' on the row afterwards.
    expect(normaliseAudience({ tags: ['Member-Active-SD'] }).tags).toEqual(['Member-Active-SD'])
  })

  it('treats anything that is not a list of strings as nothing chosen', () => {
    expect(normaliseAudience({})).toEqual(NOBODY)
    expect(normaliseAudience({ tags: 'vip', memberIds: 42 })).toEqual(NOBODY)
    expect(normaliseAudience({ tags: [1, null, 'vip'] })).toEqual({ tags: ['vip'], memberIds: [] })
  })
})

describe('namesNobody', () => {
  it('is what an unset audience means — no email, not every address we hold', () => {
    expect(namesNobody(NOBODY)).toBe(true)
    expect(namesNobody({ tags: [], memberIds: [] })).toBe(true)
  })

  it('is false the moment anybody is named', () => {
    expect(namesNobody({ tags: ['vip'], memberIds: [] })).toBe(false)
    expect(namesNobody({ tags: [], memberIds: ['a'] })).toBe(false)
  })
})

describe('memberTags', () => {
  it('reads the jsonb column as the array of strings it is by convention', () => {
    expect(memberTags({ ghl_tags: ['vip', 'avi member'] })).toEqual(['vip', 'avi member'])
  })

  it('costs one member the tag match rather than failing the send', () => {
    // ghl_tags is jsonb, so its shape is a convention and not a type.
    expect(memberTags({ ghl_tags: null })).toEqual([])
    expect(memberTags({ ghl_tags: 'vip' })).toEqual([])
    expect(memberTags({ ghl_tags: { vip: true } })).toEqual([])
    expect(memberTags({ ghl_tags: ['vip', 7, null] })).toEqual(['vip'])
    expect(memberTags({})).toEqual([])
  })
})

describe('membersCarryingAnyTag', () => {
  const roster = [
    { id: 'dana', ghl_tags: ['VIP', 'avi member'] },
    { id: 'sam', ghl_tags: ['avi member'] },
    { id: 'ash', ghl_tags: ['host', 'vip'] },
    { id: 'rowan', ghl_tags: [] },
  ]

  it('matches whoever carries any one of the tags', () => {
    expect(membersCarryingAnyTag(roster, ['avi member'])).toEqual(['dana', 'sam'])
  })

  it('is a union, not an intersection', () => {
    // Two tags mean "either", which is how an admin reads two chips in a picker.
    expect(membersCarryingAnyTag(roster, ['host', 'avi member'])).toEqual(['dana', 'sam', 'ash'])
  })

  it('ignores case on both sides', () => {
    // GHL applies its own case rules to a tag name and admins retype them by
    // hand, so an exact match would make the audience depend on capitalisation
    // nobody controls. Same rule as /admin/analytics and lib/ghl/tags.
    expect(membersCarryingAnyTag(roster, ['vip'])).toEqual(['dana', 'ash'])
    expect(membersCarryingAnyTag(roster, ['  ViP  '])).toEqual(['dana', 'ash'])
  })

  it('matches nobody for a tag nobody carries', () => {
    // A campaign tag that exists in GHL and has no members yet is offered in
    // the picker on purpose; it must resolve to nobody, and resolveEmailAudience
    // hands that empty list on as an audience rather than as "unset".
    expect(membersCarryingAnyTag(roster, ['launch-2027'])).toEqual([])
  })

  it('matches nobody when no tag was chosen', () => {
    expect(membersCarryingAnyTag(roster, [])).toEqual([])
    expect(membersCarryingAnyTag(roster, ['', '  '])).toEqual([])
  })

  it('names each member once however many of the tags they carry', () => {
    expect(membersCarryingAnyTag(roster, ['vip', 'host'])).toEqual(['dana', 'ash'])
  })
})
