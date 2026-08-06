import { describe, it, expect } from 'vitest'
import {
  ALL_ACCESS_TAGS,
  ALL_LOGIN_TAGS,
  COURSE_SLUGS,
  MEMBERSHIP_TAGS,
  courseSlugForTag,
  courseTagsHeld,
  hasAnyAccessTag,
  hasCourseAccessTag,
  hasHostTag,
  hasMembershipTag,
  hasPartnerTag,
  tagsOverlap,
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

describe('matching is case-insensitive', () => {
  // GHL applies its own case rules to a tag name and an admin can retype one by
  // hand when granting access. Exact matching would put course access — and the
  // login gate behind it — at the mercy of capitalisation nobody controls.
  const VARIANTS = ['member-active-sd', 'MEMBER-ACTIVE-SD', 'Member-Active-SD', '  member-active-SD  ']

  it('recognises every casing of a course tag', () => {
    for (const tag of VARIANTS) {
      expect(hasAnyAccessTag([tag]), tag).toBe(true)
      expect(hasCourseAccessTag([tag]), tag).toBe(true)
      expect(hasMembershipTag([tag]), tag).toBe(true)
      expect(courseSlugForTag(tag), tag).toBe('aviara')
    }
  })

  it('recognises every casing of a role tag', () => {
    expect(hasHostTag(['HOST'])).toBe(true)
    expect(hasPartnerTag(['Referral-Partner'])).toBe(true)
  })

  it('returns the canonical spelling whatever came in', () => {
    // Callers index COURSE_TAG_MAP with this, so it has to be a real key.
    expect(courseTagsHeld(['MEMBER-ACTIVE-SD'])).toEqual(['member-active-SD'])
    expect(courseTagsHeld(['AVI MEMBER'])).toEqual(['avi member'])
  })

  it('orders held tags by the map, so the home course is stable', () => {
    // syncMember takes the first entry as the home course. Deriving it from the
    // order GHL happened to return the contact's tags in would make a member's
    // home course wobble between syncs.
    expect(courseTagsHeld(['nbd client', 'MEMBER-ACTIVE-SD', 'avi member'])).toEqual([
      'avi member', 'member-active-SD', 'nbd client',
    ])
  })

  it('overlaps two lists regardless of case', () => {
    expect(tagsOverlap(['MEMBER-ACTIVE-SD'], ['member-active-SD'])).toBe(true)
    expect(tagsOverlap(['nbd client'], ['avi member'])).toBe(false)
    expect(tagsOverlap([], ['avi member'])).toBe(false)
  })

  it('still rejects a tag that only looks similar', () => {
    // Case-insensitive, not fuzzy.
    expect(hasAnyAccessTag(['member-active-LA'])).toBe(false)
    expect(hasAnyAccessTag(['memberactive-sd'])).toBe(false)
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
