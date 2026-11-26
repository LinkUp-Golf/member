import { describe, it, expect } from 'vitest'
import {
  GENDER_TAGS,
  ageOn,
  communityFromTags,
  contactUpdateBody,
  dobFromGhl,
  genderFromTags,
  genderTagChanges,
  parseDateOfBirth,
  syncedChanges,
  withoutGenderTags,
} from '@/lib/ghl/profile-fields'

const TODAY = new Date('2026-11-26T12:00:00Z')

describe('gender tags', () => {
  it('reads one gender tag, ignoring case and spaces', () => {
    expect(genderFromTags(['member-active-SD', ' Gender-Female '])).toEqual({ gender: 'female', conflict: false })
    expect(genderFromTags(['gender-pns'])).toEqual({ gender: 'prefer_not', conflict: false })
  })

  it('reads no tag as unanswered, and two as a conflict', () => {
    expect(genderFromTags(['member-active-SD'])).toEqual({ gender: null, conflict: false })
    expect(genderFromTags(['gender-male', 'gender-female'])).toEqual({ gender: null, conflict: true })
  })

  it('keeps gender out of the stored tag copy', () => {
    expect(withoutGenderTags(['member-active-SD', 'gender-male', 'GENDER-PNS', 'host'])).toEqual(['member-active-SD', 'host'])
  })

  it('adds one tag and removes the other two', () => {
    expect(genderTagChanges('female')).toEqual({ add: ['gender-female'], remove: ['gender-male', 'gender-pns'] })
    expect(genderTagChanges(null)).toEqual({ add: [], remove: Object.values(GENDER_TAGS) })
  })
})

describe('communityFromTags', () => {
  it('takes the community from the membership tag', () => {
    expect(communityFromTags(['avi member', 'member-active-SD'])).toBe('San Diego')
    expect(communityFromTags(['MEMBER-ACTIVE-sd'])).toBe('San Diego')
  })

  it('is null for someone outside every community', () => {
    expect(communityFromTags(['member-guest', 'host'])).toBeNull()
  })
})

describe('date of birth', () => {
  it('accepts a real date of an adult', () => {
    expect(parseDateOfBirth('1980-05-12', TODAY)).toBe('1980-05-12')
  })

  it('refuses impossible dates, other formats, minors and typos', () => {
    for (const bad of ['1980-02-30', '12/05/1980', '2015-01-01', '1890-01-01', '', 19800512, null]) {
      expect(parseDateOfBirth(bad, TODAY)).toBeNull()
    }
  })

  it('counts age by the calendar', () => {
    expect(ageOn('2008-11-26', TODAY)).toBe(18)
    expect(ageOn('2008-11-27', TODAY)).toBe(17)
  })

  it("reads GHL's date, timestamp or epoch ms, and treats anything else as blank", () => {
    expect(dobFromGhl('1980-05-12')).toBe('1980-05-12')
    expect(dobFromGhl('1980-05-12T00:00:00.000Z')).toBe('1980-05-12')
    expect(dobFromGhl(Date.UTC(1980, 4, 12))).toBe('1980-05-12')
    expect(dobFromGhl('')).toBeNull()
    expect(dobFromGhl(undefined)).toBeNull()
  })
})

describe('contactUpdateBody', () => {
  const ids = new Map([
    ['contact.company_name', 'cf-company'],
    ['contact.title', 'cf-title'],
    ['contact.linkedin', 'cf-linkedin'],
    ['contact.nonprofits', 'cf-np'],
  ])

  it('writes organization to the built-in Business Name only', () => {
    const { body, missing } = contactUpdateBody({ business_name: ' Reyes Dental ' }, new Map())
    expect(missing).toEqual([])
    expect(body.companyName).toBe('Reyes Dental')
    expect(body.customFields).toBeUndefined()
  })

  it('writes the title to contact.title', () => {
    const { body } = contactUpdateBody({ role_title: 'Founder & Chief Architect' }, ids)
    expect(body.customFields).toEqual([{ id: 'cf-title', field_value: 'Founder & Chief Architect' }])
  })

  it('writes non-profits one per line and clears with empty values', () => {
    const { body } = contactUpdateBody({ nonprofits: ['First Tee', 'Rady'], role_title: null, date_of_birth: null }, ids)
    expect(body.customFields).toEqual([
      { id: 'cf-title', field_value: '' },
      { id: 'cf-np', field_value: 'First Tee\nRady' },
    ])
    expect(body.dateOfBirth).toBeNull()
  })

  it('reports a field GHL does not have instead of skipping it', () => {
    const { missing } = contactUpdateBody({ linkedin_url: 'https://linkedin.com/in/x' }, new Map())
    expect(missing).toEqual(['contact.linkedin'])
  })
})

describe('syncedChanges', () => {
  const before = { business_name: 'Reyes Dental', role_title: 'Owner', linkedin_url: null, nonprofits: ['First Tee'] }

  it('ignores a save that touches nothing GHL holds', () => {
    expect(syncedChanges(before, { display_name: 'Dana' } as never)).toEqual({})
    expect(syncedChanges(before, { business_name: ' Reyes Dental ', nonprofits: 'First Tee' } as never)).toEqual({})
  })

  it('picks out only what changed', () => {
    expect(syncedChanges(before, { business_name: 'Reyes Ortho', role_title: 'Owner', nonprofits: 'First Tee\nRady' } as never))
      .toEqual({ business_name: 'Reyes Ortho', nonprofits: ['First Tee', 'Rady'] })
  })

  it('reads an emptied field as clearing it', () => {
    expect(syncedChanges(before, { role_title: '' })).toEqual({ role_title: null })
  })
})
