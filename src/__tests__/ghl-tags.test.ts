import { describe, it, expect } from 'vitest'
import {
  ALL_ACCESS_TAGS,
  ALL_LOGIN_TAGS,
  COURSE_SLUGS,
  MEMBERSHIP_TAGS,
  courseSlugForTag,
  hasAnyAccessTag,
  hasCourseAccessTag,
  hasHostTag,
  hasMembershipTag,
  hasPartnerTag,
} from '@/lib/ghl/tags'

// The tag map is the gate on login, home course, course_memberships and
// referral commission all at once, so a typo here is an outage rather than a
// bug. These lock down what each tag is worth.

const SD = 'member-active-SD'

describe('member-active-SD', () => {
  it('grants app access on its own', () => {
    expect(hasAnyAccessTag([SD])).toBe(true)
  })

  it('counts as course access, so the holder is a golf member not a role-only user', () => {
    expect(hasCourseAccessTag([SD])).toBe(true)
  })

  it('counts as a membership, so a referral converting into it earns commission', () => {
    expect(hasMembershipTag([SD])).toBe(true)
  })

  it('maps to Aviara', () => {
    expect(courseSlugForTag(SD)).toBe('aviara')
  })

  it('is swept by the bulk GHL sync', () => {
    // runBulkGhlSync iterates this list to query GHL for contacts. Missing here
    // means a member holding only this tag is never imported.
    expect(ALL_LOGIN_TAGS).toContain(SD)
  })
})

describe('the tags it sits beside', () => {
  it('leaves the existing Aviara tags working', () => {
    // Adding SD is additive — no member carrying an older spelling loses access.
    for (const tag of ['avi member', 'avi member - active', 'nbd client']) {
      expect(hasCourseAccessTag([tag]), tag).toBe(true)
      expect(courseSlugForTag(tag), tag).toBe('aviara')
    }
  })

  it('keeps nbd client as access without membership', () => {
    // Access and membership are deliberately different sets: an NBD client can
    // book, but no referral partner gets paid for one.
    expect(hasCourseAccessTag(['nbd client'])).toBe(true)
    expect(hasMembershipTag(['nbd client'])).toBe(false)
  })

  it('does not treat a role tag as course access', () => {
    // A host or partner with no golf membership syncs as 'non_member' with no
    // home course — hasCourseAccessTag is what decides that.
    expect(hasAnyAccessTag(['host'])).toBe(true)
    expect(hasCourseAccessTag(['host'])).toBe(false)
    expect(hasHostTag(['host'])).toBe(true)
    expect(hasPartnerTag(['referral-partner'])).toBe(true)
  })

  it('grants nothing for an unrelated tag', () => {
    expect(hasAnyAccessTag(['newsletter', 'some-other-tag'])).toBe(false)
    expect(courseSlugForTag('newsletter')).toBeNull()
  })
})

describe('derived lists stay consistent', () => {
  it('every membership tag is also an access tag', () => {
    // The reverse isn't true (nbd client). But a membership tag that didn't
    // grant access would pay commission to someone who can't book.
    for (const tag of MEMBERSHIP_TAGS) expect(ALL_ACCESS_TAGS, tag).toContain(tag)
  })

  it('exposes one course slug, deduplicated across the four tags', () => {
    expect(COURSE_SLUGS).toEqual(['aviara'])
  })
})
