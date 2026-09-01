import { describe, it, expect } from 'vitest'
import {
  activityForPath,
  activitySpec,
  isClientAction,
  ACTIVITY_ACTIONS,
  ACTIVITY_AREAS,
  FOCUS_AREAS,
  AREA_LABELS,
} from '@/lib/activity/areas'

// This registry decides what the usage report can answer. The client tracker
// maps paths through it, the ingest route trusts it to say which area an
// event belongs to, and the admin page labels rows from it — so a wrong entry
// here misfiles activity rather than failing loudly.

const PROMO_ID = 'a3f1c8d2-4b6e-4f1a-9c7d-2e5b8a1f6d40'

describe('activityForPath', () => {
  it('maps the tee-time calendar', () => {
    expect(activityForPath('/book')).toEqual({ action: 'calendar_viewed' })
  })

  it('separates the hosted-events calendar from the events list', () => {
    expect(activityForPath('/more/hosted-events/calendar')).toEqual({ action: 'host_calendar_viewed' })
    expect(activityForPath('/more/hosted-events')).toEqual({ action: 'events_viewed' })
  })

  it('treats the directory listing and a single profile as different activity', () => {
    expect(activityForPath('/members')).toEqual({ action: 'directory_viewed' })
    expect(activityForPath(`/members/${PROMO_ID}`)).toEqual({
      action: 'member_profile_viewed',
      targetId: PROMO_ID,
    })
  })

  it('carries the id through for promotions and announcements', () => {
    expect(activityForPath(`/more/promotions/${PROMO_ID}`)).toEqual({
      action: 'promotion_opened',
      targetId: PROMO_ID,
    })
    expect(activityForPath(`/more/announcements/${PROMO_ID}`)).toEqual({
      action: 'announcement_opened',
      targetId: PROMO_ID,
    })
  })

  it('falls back to the listing when the id segment is not a UUID', () => {
    // A slug or a stray path segment must not be written into a uuid column.
    expect(activityForPath('/more/promotions/not-a-uuid')).toEqual({ action: 'promotions_viewed' })
  })

  it('tracks the messages list but never a thread', () => {
    expect(activityForPath('/messages')).toEqual({ action: 'messages_viewed' })
    expect(activityForPath('/messages/abc')).toBeNull()
  })

  it('ignores trailing slashes', () => {
    expect(activityForPath('/members/')).toEqual({ action: 'directory_viewed' })
  })

  it('returns null for untracked and admin paths', () => {
    expect(activityForPath('/admin/analytics')).toBeNull()
    expect(activityForPath('/more/guest-access')).toBeNull()
    expect(activityForPath('/')).toBeNull()
  })
})

describe('isClientAction', () => {
  it('accepts page views the tracker emits', () => {
    expect(isClientAction('promotions_viewed')).toBe(true)
  })

  it('rejects transactions only the server may record', () => {
    // Otherwise a member could POST themselves a booking into the report.
    expect(isClientAction('booking_created')).toBe(false)
    expect(isClientAction('member_message_started')).toBe(false)
  })

  it('rejects the sign-in event', () => {
    // Seeded from members.last_sign_in and written by the auth callback. A
    // client that could post it would be able to fake its own adoption.
    expect(isClientAction('signed_in')).toBe(false)
    expect(activitySpec('signed_in')?.area).toBe('session')
    expect(activitySpec('signed_in')?.kind).toBe('action')
  })

  it('rejects anything not in the registry', () => {
    expect(isClientAction('nice_try')).toBe(false)
    // Inherited object keys must not read as registered actions.
    expect(isClientAction('toString')).toBe(false)
    expect(activitySpec('constructor')).toBeNull()
  })
})

describe('registry integrity', () => {
  it('files every action under a known area', () => {
    for (const spec of Object.values(ACTIVITY_ACTIONS)) {
      expect(ACTIVITY_AREAS).toContain(spec.area)
    }
  })

  it('labels every area for the admin UI', () => {
    for (const area of ACTIVITY_AREAS) {
      expect(AREA_LABELS[area]).toBeTruthy()
    }
  })

  it('gives each of the four reported areas at least one visit and one action', () => {
    // The report's per-area "visits vs actions" split is only meaningful if
    // both are actually reachable in that area.
    for (const area of FOCUS_AREAS) {
      const specs = Object.values(ACTIVITY_ACTIONS).filter(spec => spec.area === area)
      expect(specs.some(spec => spec.kind === 'view')).toBe(true)
      expect(specs.some(spec => spec.kind === 'action')).toBe(true)
    }
  })

  it('keeps sign-ins out of the four reported areas', () => {
    // Sign-ins answer "did they open the app at all", which is a different
    // question from what they did in calendars/promotions/announcements/
    // directory — folding it into those would inflate every reach figure.
    expect(FOCUS_AREAS).not.toContain('session')
    expect(ACTIVITY_AREAS).toContain('session')
  })

  it('maps every path-derived action to a client-emittable one', () => {
    const paths = [
      '/home', '/book', '/members', `/members/${PROMO_ID}`, '/messages',
      '/more', '/more/promotions', `/more/promotions/${PROMO_ID}`,
      '/more/announcements', `/more/announcements/${PROMO_ID}`,
      '/more/hosted-events', '/more/hosted-events/calendar', `/more/hosted-events/${PROMO_ID}`,
      '/more/events', '/more/profile', '/more/settings',
    ]
    for (const path of paths) {
      const activity = activityForPath(path)
      expect(activity, path).not.toBeNull()
      expect(isClientAction(activity!.action), path).toBe(true)
    }
  })
})
