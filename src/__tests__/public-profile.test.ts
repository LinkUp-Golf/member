import { describe, it, expect } from 'vitest'
import {
  DEFAULT_GOLFER_DESCRIPTION,
  PUBLIC_MEMBER_SELECT,
  golferSummaryText,
  publicMember,
  type PublicProfileRow,
} from '@/lib/members/public-profile'

describe('golferSummaryText', () => {
  it("shows the member's own words when they wrote some", () => {
    expect(golferSummaryText('Early riser, walks every round')).toBe('Early riser, walks every round')
  })

  it('shows the default for a blank Golfer Summary', () => {
    for (const blank of [null, undefined, '', '   ']) expect(golferSummaryText(blank)).toBe(DEFAULT_GOLFER_DESCRIPTION)
  })

  it('never puts the default into the profile data itself', () => {
    const m = publicMember(
      { id: 'm1', first_name: 'A', last_name: 'B', profile: { golfer_description: null }, home_course: null },
      { isSelf: false, isAdmin: false },
    )
    expect(m.profile?.golfer_description).toBeNull()
  })
})

const row = (profile: Record<string, unknown> | null): PublicProfileRow => ({
  id: 'm1',
  first_name: 'Dana',
  last_name: 'Reyes',
  profile,
  home_course: [{ id: 'c1', name: 'Aviara', city: 'Carlsbad' }],
})

const visible = { business_name: 'Reyes Dental', handicap_index: 12.4, show_handicap: false, profile_visible: true }
const other = { isSelf: false, isAdmin: false }

describe('publicMember', () => {
  it('never reads private member columns', () => {
    // ghl_tags is read, to work out the community, but never returned (below).
    for (const col of ['email', 'phone', 'ghl_contact_id', 'is_admin', 'membership_status', '*']) {
      expect(PUBLIC_MEMBER_SELECT).not.toMatch(new RegExp(`(^|[\\s,(])${col.replace('*', '\\*')}([\\s,)]|$)`))
    }
  })

  it('returns only the public shape', () => {
    const m = publicMember(row(visible), other)
    expect(Object.keys(m).sort()).toEqual(['community', 'first_name', 'home_course', 'id', 'last_name', 'profile'])
    expect(m.home_course).toEqual({ id: 'c1', name: 'Aviara', city: 'Carlsbad' })
  })

  it('gives the community, never the tags it came from', () => {
    const m = publicMember({ ...row(visible), ghl_tags: ['member-active-SD', 'gender-female', 'host'] }, other)
    expect(m.community).toBe('San Diego')
    expect(JSON.stringify(m)).not.toMatch(/gender|member-active|host/i)
  })

  it('hides a handicap the member hides, from other members only', () => {
    expect(publicMember(row(visible), other).profile?.handicap_index).toBeNull()
    expect(publicMember(row(visible), { isSelf: true, isAdmin: false }).profile?.handicap_index).toBe(12.4)
    expect(publicMember(row(visible), { isSelf: false, isAdmin: true }).profile?.handicap_index).toBe(12.4)
    expect(publicMember(row({ ...visible, show_handicap: true }), other).profile?.handicap_index).toBe(12.4)
  })

  it('gives other members only the name of a hidden profile', () => {
    const hidden = { ...visible, profile_visible: false }
    const m = publicMember(row(hidden), other)
    expect(m.profile).toBeNull()
    expect([m.first_name, m.last_name]).toEqual(['Dana', 'Reyes'])
    expect(publicMember(row(hidden), { isSelf: true, isAdmin: false }).profile?.business_name).toBe('Reyes Dental')
  })

  it('copes with no profile row and a missing name', () => {
    const m = publicMember({ ...row(null), first_name: null }, other)
    expect(m.profile).toBeNull()
    expect(m.first_name).toBe('')
  })
})
