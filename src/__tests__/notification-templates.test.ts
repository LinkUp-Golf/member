import { describe, it, expect } from 'vitest'
import { NotificationTemplates } from '@/lib/push'

// One definition per notification feeds both channels, so these guard the two
// fields only the email reads. Nothing else in the app would notice if either
// went missing, and by the time a member does it has been sent.

describe('coverage of the template set', () => {
  // A notification that can be pushed can be emailed. A template without a
  // cta would render a button saying nothing in particular, and one without a
  // subject would arrive under a push title written for a different context.
  const rendered = [
    NotificationTemplates.newMember('Dana', 'McBride', 'Aviara', 'm1'),
    NotificationTemplates.bookingAnnouncement('Dana', 'Sat 27 Sep', '1:30pm', 'm1'),
    NotificationTemplates.visitingMember('Dana', 'McBride', 'Mon', 'Fri', 'm1'),
    NotificationTemplates.newMessage('Dana', 'hello', 'c1'),
    NotificationTemplates.focusLinkup('Finance', 'Sat', 2),
    NotificationTemplates.curatedIntroduction(),
    NotificationTemplates.curatedIntroduction(3),
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
    NotificationTemplates.bookingInvite('Dana', 'Aviara', 'Sat', '1:30pm', true, 'b1'),
    NotificationTemplates.bookingInviteAccepted('Sam', 'Aviara', 'Sat'),
    NotificationTemplates.bookingInviteDeclined('Sam', 'Aviara', 'Sat'),
    NotificationTemplates.bookingInviteExpired('Sam', 'Aviara', 'Sat'),
    NotificationTemplates.bookingMoved('Aviara', 'Sat', '1:30pm'),
    NotificationTemplates.bookingMadeForYou('Aviara', 'Sat', '1:30pm'),
    NotificationTemplates.bookingPaymentReady('Sat', '1:30pm'),
    NotificationTemplates.bookingConfirmed('Aviara', 'Sat', '1:30pm', { players: ['Dana'], payAtClub: false }),
    NotificationTemplates.bookingCreatedForAdmins('Dana', 'Aviara', 'Sat', '1:30pm', { players: ['Dana'], payAtClub: false, bookedByAdmin: false }),
    NotificationTemplates.roundSurvey('Aviara', 'b1'),
    NotificationTemplates.groupChatInvite('Dana', 'Finance', 'c1'),
    NotificationTemplates.memberEventRejected('Event', 'no'),
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

})

describe('booking confirmations', () => {
  // GHL's versions of these arrived with the venue, date and tee time blank —
  // the whole reason the app sends them. Each one must carry all three.
  const details = { players: ['Greg Lipper', 'Dana Smith', 'sam@example.com'], payAtClub: false }

  it("puts the venue, date, tee time and players in the member's email", () => {
    const p = NotificationTemplates.bookingConfirmed('Park Hyatt Aviara', 'Saturday, December 6', '8:30 AM', {
      ...details,
      address: '7100 Aviara Resort Dr, Carlsbad',
    })
    expect(p.subject).toBe('Booking confirmed: Park Hyatt Aviara, Saturday, December 6 at 8:30 AM')
    expect(p.body).toContain('Park Hyatt Aviara on Saturday, December 6 at 8:30 AM')
    expect(p.body).toContain('Players: Greg Lipper, Dana Smith and sam@example.com.')
    expect(p.body).toContain('Address: 7100 Aviara Resort Dr, Carlsbad.')
    expect(p.body).toContain('Payment is due')
  })

  it('leaves out a players line for a solo round, and says when the club is paid', () => {
    const p = NotificationTemplates.bookingConfirmed('Aviara', 'Sat', '8:30 AM', { players: ['Greg'], payAtClub: true })
    expect(p.body).not.toContain('Players:')
    expect(p.body).toContain('pay at the club')
  })

  it("puts the venue, date, tee time and players in the admins' email", () => {
    const p = NotificationTemplates.bookingCreatedForAdmins('greg lipper', 'Park Hyatt Aviara', 'Saturday, December 6', '8:30 AM', {
      ...details,
      bookedByAdmin: false,
    })
    expect(p.subject).toBe('New booking: Greg Lipper at Park Hyatt Aviara, Saturday, December 6 at 8:30 AM')
    expect(p.body).toContain('Greg Lipper booked Park Hyatt Aviara on Saturday, December 6 at 8:30 AM.')
    expect(p.body).toContain('3 players: Greg Lipper, Dana Smith and sam@example.com.')
    expect(p.url).toBe('/admin/bookings')
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
