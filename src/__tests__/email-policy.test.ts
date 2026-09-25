import { describe, it, expect } from 'vitest'
import { categoryFor, notificationKey, CATEGORY_BY_TAG } from '@/lib/email/policy'
import { NotificationTemplates } from '@/lib/push'

describe('notificationKey', () => {
  it('collapses an instance to its kind, so the log groups', () => {
    // Without this, email_send_log would hold one key per conversation and
    // tell you nothing about how much a member is getting.
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
  it('falls back to community for anything it has never heard of', () => {
    // Classification only — an unknown tag is still sent, just recorded under
    // the least specific heading.
    expect(categoryFor('something-new')).toBe('community')
    expect(categoryFor(undefined)).toBe('community')
  })

  it('files money, access and a cancelled round as transactional', () => {
    expect(categoryFor('payment-ready')).toBe('transactional')
    expect(categoryFor('host-credit-approved')).toBe('transactional')
    expect(categoryFor('hosted-event-cancelled')).toBe('transactional')
    expect(categoryFor('booking-invite')).toBe('transactional')
  })

  it('files the community feed as community', () => {
    expect(categoryFor('new-member')).toBe('community')
    expect(categoryFor('promotion-titleist')).toBe('community')
    expect(categoryFor('booking-2026-09-27')).toBe('community')
  })
})

describe('coverage of the template set', () => {
  // The point of the whole exercise: a notification that can be pushed can be
  // emailed. A template without a cta would render a button saying nothing in
  // particular, and one whose tag isn't classified would be logged under a
  // fallback heading — fine as a safety net, wrong as an oversight.
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

  it('gives every template its own subject line', () => {
    // Falling back to `title` is the safety net, not the plan: several titles
    // are fragments that only make sense beside the app's name — a bare
    // sender's name, "New reservation", "Your event is live".
    const missing = rendered.filter(p => !p.subject).map(p => p.tag)
    expect(missing).toEqual([])
  })

  it('writes subjects that stand on their own in an inbox', () => {
    // A subject identical to a title that was written for a push is the shape
    // of one that was added without being thought about.
    const lazy = rendered.filter(p => p.subject === p.title).map(p => p.tag)
    expect(lazy).toEqual([])
  })

  it('classifies every template explicitly rather than by fallback', () => {
    const unclassified = rendered
      .map(p => notificationKey(p.tag))
      .filter(key => !(key in CATEGORY_BY_TAG))
    expect(Array.from(new Set(unclassified))).toEqual([])
  })
})

describe('names in subject lines', () => {
  // Names are stored however a member typed them into GHL, which is often
  // lower-case. A push title is read beside an avatar and a body; a subject
  // line is the first and sometimes only thing seen, and "dana mcbride sent
  // you a message" reads like spam.
  it('capitalises a lower-case name', () => {
    expect(NotificationTemplates.newMessage('dana mcbride', 'hi', 'c1').subject).toBe(
      'Dana Mcbride sent you a message',
    )
  })

  it('leaves a name that is already capitalised alone', () => {
    expect(
      NotificationTemplates.hostedEventJoined('Dana McBride', 'Aviara', 'Sat').subject,
    ).toBe('Dana McBride reserved a spot at your Aviara event')
  })

  it('handles hyphens and apostrophes', () => {
    expect(NotificationTemplates.referralJoined("mary-jane o'neil").subject).toBe(
      "Mary-Jane O'Neil has joined LinkUp",
    )
  })

  it('capitalises the heading and body too, not only the subject', () => {
    // The email's heading is the push title and its paragraph is the push
    // body, so a name left lower-case there is just as visible.
    const joined = NotificationTemplates.hostedEventJoined('dana mcbride', 'Aviara', 'Sat')
    expect(joined.body).toContain('Dana Mcbride reserved')

    const message = NotificationTemplates.newMessage('dana mcbride', 'hi', 'c1')
    expect(message.title).toBe('Dana Mcbride')
  })

  it('leaves the dedup tag lower-cased, since it is a key and not copy', () => {
    expect(NotificationTemplates.visitingMember('Dana', 'McBride', 'Mon', 'Fri').tag).toBe(
      'visit-dana',
    )
  })
})
