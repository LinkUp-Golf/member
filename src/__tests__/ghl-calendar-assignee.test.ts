import { describe, it, expect } from 'vitest'
import { pickCalendarAssignee } from '@/lib/ghl/client'

// Every appointment we create used to name one hardcoded user, which held only
// for as long as that user stayed on every calendar — change a calendar's host
// in GHL and the id belongs to someone who isn't on it. The assignee comes off
// the calendar's own teamMembers now, and this is the part that reads it.
//
// GHL's Get Calendar docs don't expand the calendar object's child attributes,
// so the shape is handled tolerantly rather than trusted. These pin what
// "tolerantly" means, including the shapes we haven't seen.

// Only the fields the picker looks at; the real object carries far more.
const cal = (over: Record<string, unknown> = {}) =>
  ({ id: 'cal_1', name: 'Aviara', calendarType: 'event', slug: null, groupId: null, ...over }) as never

describe('pickCalendarAssignee', () => {
  it('takes the only team member', () => {
    expect(pickCalendarAssignee(cal({ teamMembers: [{ userId: 'u_host' }] }))).toBe('u_host')
  })

  it('takes the first of several when none is flagged', () => {
    expect(
      pickCalendarAssignee(cal({ teamMembers: [{ userId: 'u_one' }, { userId: 'u_two' }] })),
    ).toBe('u_one')
  })

  it('prefers the primary team member over the first', () => {
    expect(
      pickCalendarAssignee(
        cal({ teamMembers: [{ userId: 'u_one' }, { userId: 'u_two', isPrimary: true }] }),
      ),
    ).toBe('u_two')
  })

  it('prefers a selected team member over the first', () => {
    expect(
      pickCalendarAssignee(
        cal({ teamMembers: [{ userId: 'u_one' }, { userId: 'u_two', selected: true }] }),
      ),
    ).toBe('u_two')
  })

  it('ignores priority when ranking', () => {
    // On a round-robin calendar priority is a distribution weight, not
    // seniority, so reading it as "most senior" would be a misreading.
    expect(
      pickCalendarAssignee(
        cal({ teamMembers: [{ userId: 'u_one', priority: 0.1 }, { userId: 'u_two', priority: 0.9 }] }),
      ),
    ).toBe('u_one')
  })

  it('skips team members with no user id', () => {
    expect(
      pickCalendarAssignee(
        cal({ teamMembers: [{ priority: 1 }, { userId: null }, { userId: 'u_real' }] }),
      ),
    ).toBe('u_real')
  })

  it('falls back to a single-owner calendar\'s assignedUserId', () => {
    expect(pickCalendarAssignee(cal({ assignedUserId: 'u_owner' }))).toBe('u_owner')
  })

  it('falls back to a single-owner calendar\'s userId', () => {
    expect(pickCalendarAssignee(cal({ userId: 'u_owner' }))).toBe('u_owner')
  })

  it('prefers a team member over the calendar-level owner', () => {
    expect(
      pickCalendarAssignee(cal({ teamMembers: [{ userId: 'u_host' }], userId: 'u_owner' })),
    ).toBe('u_host')
  })

  it('ignores blank ids', () => {
    expect(pickCalendarAssignee(cal({ assignedUserId: '   ', userId: '' }))).toBeNull()
  })

  it('returns null for a calendar that names nobody', () => {
    expect(pickCalendarAssignee(cal())).toBeNull()
    expect(pickCalendarAssignee(cal({ teamMembers: [] }))).toBeNull()
    expect(pickCalendarAssignee(cal({ teamMembers: null }))).toBeNull()
  })

  it('returns null for no calendar at all', () => {
    expect(pickCalendarAssignee(null)).toBeNull()
    expect(pickCalendarAssignee(undefined)).toBeNull()
  })
})
