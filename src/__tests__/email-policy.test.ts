import { describe, it, expect } from 'vitest'
import {
  categoryFor,
  notificationKey,
  throttleDecision,
  CATEGORY_BY_TAG,
  DAILY_EMAIL_CAP,
  type ThrottleState,
} from '@/lib/email/policy'
import { NotificationTemplates } from '@/lib/push'

const state = (over: Partial<ThrottleState> = {}): ThrottleState => ({
  lastSentAt: null,
  sentInWindow: 0,
  ...over,
})

const NOW = Date.parse('2026-09-25T12:00:00.000Z')
const hoursAgo = (n: number) => new Date(NOW - n * 60 * 60 * 1000).toISOString()

describe('notificationKey', () => {
  it('collapses an instance to its kind, so a cooldown means something', () => {
    // Without this every conversation would carry its own email budget.
    expect(notificationKey('msg-8f3c-conversation-id')).toBe('msg')
    expect(notificationKey('booking-survey-abc123')).toBe('booking-survey')
    expect(notificationKey('visit-dana')).toBe('visit')
  })

  it('prefers the longer of two tags that share a prefix', () => {
    // 'booking-invite' is a commitment; 'booking-2026-09-27' is someone else's
    // tee time. Shortest-prefix matching would make them the same thing.
    expect(notificationKey('booking-invite')).toBe('booking-invite')
    expect(notificationKey('booking-survey-1')).toBe('booking-survey')
    expect(notificationKey('booking-2026-09-27')).toBe('booking')
  })
})

describe('categoryFor', () => {
  it('rations anything it has never heard of', () => {
    // A new notification should not be able to reach every member daily just
    // because nobody remembered to classify it.
    expect(categoryFor('something-new')).toBe('community')
    expect(categoryFor(undefined)).toBe('community')
  })

  it('never suppresses money, access or a cancelled round', () => {
    expect(categoryFor('payment-ready')).toBe('transactional')
    expect(categoryFor('host-credit-approved')).toBe('transactional')
    expect(categoryFor('hosted-event-cancelled')).toBe('transactional')
    expect(categoryFor('booking-invite')).toBe('transactional')
  })

  it('rations the community feed', () => {
    expect(categoryFor('new-member')).toBe('community')
    expect(categoryFor('promotion-titleist')).toBe('community')
    expect(categoryFor('booking-2026-09-27')).toBe('community')
  })
})

describe('throttleDecision', () => {
  it('lets a transactional notification through a full inbox', () => {
    const d = throttleDecision(
      'transactional',
      state({ sentInWindow: DAILY_EMAIL_CAP + 5, lastSentAt: hoursAgo(0) }),
      NOW,
    )
    expect(d.send).toBe(true)
  })

  it('stops the same community notification twice in a day', () => {
    const d = throttleDecision('community', state({ lastSentAt: hoursAgo(2) }), NOW)
    expect(d).toEqual({ send: false, reason: 'cooldown' })
  })

  it('lets it through once the cooldown has passed', () => {
    const d = throttleDecision('community', state({ lastSentAt: hoursAgo(21) }), NOW)
    expect(d.send).toBe(true)
  })

  it('stops community mail once the day is full', () => {
    const d = throttleDecision('community', state({ sentInWindow: DAILY_EMAIL_CAP }), NOW)
    expect(d).toEqual({ send: false, reason: 'daily_cap' })
  })

  it('caps conversations but does not cool them down', () => {
    // A reply an hour after the last one is a real message; the quiet comes
    // from the caught-up rule in messages/email-policy, not from here.
    expect(throttleDecision('conversation', state({ lastSentAt: hoursAgo(1) }), NOW).send).toBe(true)
    expect(
      throttleDecision('conversation', state({ sentInWindow: DAILY_EMAIL_CAP }), NOW).reason,
    ).toBe('daily_cap')
  })

  it('sends rather than stays silent on an unreadable timestamp', () => {
    expect(throttleDecision('community', state({ lastSentAt: 'nonsense' }), NOW).send).toBe(true)
  })
})

describe('coverage of the template set', () => {
  // The point of the whole exercise: a notification that can be pushed can be
  // emailed. A template without a cta would render a button saying nothing in
  // particular, and one whose tag isn't classified would quietly default to
  // being rationed — fine as a fallback, wrong as an oversight.
  const rendered = [
    NotificationTemplates.newMember('Dana', 'McBride', 'Aviara', 'm1'),
    NotificationTemplates.bookingAnnouncement('Dana', 'Sat 27 Sep', '1:30pm', 'm1'),
    NotificationTemplates.visitingMember('Dana', 'McBride', 'Mon', 'Fri', 'm1'),
    NotificationTemplates.newMessage('Dana', 'hello', 'c1'),
    NotificationTemplates.focusLinkup('Finance', 'Sat', 2),
    NotificationTemplates.playSuggestion('Dana', 'm1'),
    NotificationTemplates.guestAccessApproved('Aviara', 'Mon', 'Fri'),
    NotificationTemplates.referralPartnerApproved(10),
    NotificationTemplates.referralListImported(3, 5),
    NotificationTemplates.referralListRejected('bad file'),
    NotificationTemplates.referralCommissionPaid(120),
    NotificationTemplates.referralPartnerRejected('not yet'),
    NotificationTemplates.referralJoined('Dana'),
    NotificationTemplates.announcementBroadcast('Title', 'Body'),
    NotificationTemplates.promotionAvailable('Titleist', 'New irons', 'p1'),
    NotificationTemplates.memberActivated('Dana'),
    NotificationTemplates.bookingInvite('Dana', 'Sat', '1:30pm'),
    NotificationTemplates.bookingPaymentReady('Sat', '1:30pm'),
    NotificationTemplates.roundSurvey('Aviara', 'b1'),
    NotificationTemplates.groupChatInvite('Dana', 'Finance', 'c1'),
    NotificationTemplates.memberEventRejected('Event', 'no'),
    NotificationTemplates.hostApplicationApproved(),
    NotificationTemplates.hostApplicationRejected('no'),
    NotificationTemplates.hostedEventPublished('Aviara', 'Sat'),
    NotificationTemplates.hostedEventNeedsReview('Dana', 'Aviara', 'Sat'),
    NotificationTemplates.hostedEventApproved('Aviara', 'Sat'),
    NotificationTemplates.venueApproved('Aviara'),
    NotificationTemplates.hostedEventDatesHeld('Aviara', 2),
    NotificationTemplates.hostedEventRejected('Aviara', 'Sat', 'why'),
    NotificationTemplates.hostedEventJoined('Dana', 'Aviara', 'Sat'),
    NotificationTemplates.hostedEventProofSubmitted('Dana', 'Aviara', 'Sat'),
    NotificationTemplates.hostCreditApproved(100),
    NotificationTemplates.hostCreditRejected('no'),
    NotificationTemplates.creditRedeemed(50),
    NotificationTemplates.creditCouponIssued(50, 'CODE'),
    NotificationTemplates.creditRedemptionRequested('Dana', 50),
    NotificationTemplates.hostedEventCancelled('Aviara', 'Sat'),
    NotificationTemplates.hostedEventUpdated('Aviara', 'Sat'),
    NotificationTemplates.hostedEventMemberCancelled('Dana', 'Aviara', 'Sat'),
  ]

  it('gives every template a button label', () => {
    const missing = rendered.filter(p => !p.cta).map(p => p.tag)
    expect(missing).toEqual([])
  })

  it('classifies every template explicitly rather than by fallback', () => {
    const unclassified = rendered
      .map(p => notificationKey(p.tag))
      .filter(key => !(key in CATEGORY_BY_TAG))
    expect(Array.from(new Set(unclassified))).toEqual([])
  })
})
