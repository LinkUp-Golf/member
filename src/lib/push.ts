// ============================================================
// LinkUp Golf — Push Notification Utility (public API)
//
// Server-side only.  All heavy lifting is in lib/push/.
// This file re-exports the high-level helpers used elsewhere
// in the codebase (cron routes, webhook handlers, etc.).
// ============================================================

export type { PushPayload, SendResult } from './push/types'
export {
  sendToUser   as sendPushToMember,
  sendToUsers  as sendPushToMembers,
  sendToAll    as sendPushToAll,
  logNotificationsOnly,
} from './push/pushService'

import { createAdminClient } from '@/lib/supabase-server'
import { sendToUsers } from './push/pushService'
import type { PushPayload, SendResult } from './push/types'
import { titleCaseName } from '@/lib/utils'
import type { PayoutMethod } from '@/types'

// ---- sendPushToCourse ---------------------------------------
// Fetches all active member IDs for a course, then dispatches.
// Kept here because it needs a Supabase query that doesn't
// belong in the generic push service.

// Exported because email needs to reach exactly the same people. Resolving the
// audience once and handing the ids to both channels is what keeps a
// course-wide notification from meaning two different things in two inboxes.
export async function courseMemberIds(
  courseId: string,
  excludeUserId?: string
): Promise<string[]> {
  const supabase = createAdminClient()

  let query = supabase
    .from('course_memberships')
    .select('member_id')
    .eq('course_id', courseId)
    .eq('status', 'active')

  if (excludeUserId) {
    query = query.neq('member_id', excludeUserId)
  }

  const { data: members } = await query
  return (members ?? []).map((m: { member_id: string }) => m.member_id)
}

export async function sendPushToCourse(
  courseId: string,
  payload: PushPayload,
  excludeUserId?: string
): Promise<SendResult> {
  const userIds = await courseMemberIds(courseId, excludeUserId)
  if (!userIds.length) return { sent: 0, failed: 0, cleaned: 0 }
  return sendToUsers(userIds, payload)
}

// ---- sendPushToAdmins ---------------------------------------
// Fetches all admin member IDs (is_admin = true), then dispatches.
// Used to alert admins about requests that need their attention.

export async function sendPushToAdmins(payload: PushPayload): Promise<SendResult> {
  const supabase = createAdminClient()

  const { data: admins } = await supabase
    .from('members')
    .select('id')
    .eq('is_admin', true)

  if (!admins?.length) return { sent: 0, failed: 0, cleaned: 0 }

  const userIds = admins.map((m: { id: string }) => m.id)
  return sendToUsers(userIds, payload)
}

// The members whose focus linkup subscriptions overlap with focusCategories.
// Falls back to every course member when the list is empty.
export async function focusMemberIds(
  courseId: string,
  focusCategories: string[],
  excludeUserId?: string
): Promise<string[]> {
  if (!focusCategories.length) return courseMemberIds(courseId, excludeUserId)

  const memberIds = await courseMemberIds(courseId, excludeUserId)
  if (!memberIds.length) return []

  const { data: subs } = await createAdminClient()
    .from('focus_linkup_subscriptions')
    .select('member_id, industry_focus, custom_label, status')
    .in('member_id', memberIds)

  return [...new Set(
    (subs ?? [])
      .filter((s: { industry_focus: string; custom_label: string | null; status: string }) => {
        if (focusCategories.includes(s.industry_focus) && s.status !== 'declined') return true
        if (s.custom_label && focusCategories.includes(s.custom_label) && s.status === 'approved') return true
        return false
      })
      .map((s: { member_id: string }) => s.member_id)
  )]
}

// Sends to course members whose focus linkup subscriptions overlap with
// focusCategories. Falls back to all course members when the list is empty.
export async function sendPushToFocusMembers(
  courseId: string,
  focusCategories: string[],
  payload: PushPayload,
  excludeUserId?: string
): Promise<SendResult> {
  const subscribedIds = await focusMemberIds(courseId, focusCategories, excludeUserId)
  if (!subscribedIds.length) return { sent: 0, failed: 0, cleaned: 0 }
  return sendToUsers(subscribedIds, payload)
}

// ---- Notification templates ---------------------------------
//
// One definition per notification, used by both channels. `title`, `body` and
// `url` are all push needs. Two fields exist only for the email and are
// ignored by push: `cta`, the wording on the button, and `subject`, the line
// the notification arrives under.
//
// `subject` is separate from `title` because they're read in different places.
// A push title sits beside the app's own name with the body directly under it,
// so "New reservation" is clear. The same words alone in an inbox, among mail
// from everyone else, are not — hence "Dana reserved a spot at your Aviara
// event". Say who and what; the heading inside still carries the short form.

export const NotificationTemplates = {
  newMember: (firstName: string, lastName: string, courseName: string, memberId?: string): PushPayload => {
    const first = titleCaseName(firstName)
    const full = titleCaseName(`${firstName} ${lastName}`)
    return {
      title: `New member: ${full}`,
      body:  `${first} has joined the ${courseName} community. Tap to view their profile.`,
      url:   memberId ? `/members/${memberId}` : '/members',
      tag:   'new-member',
      subject: `${full} has joined ${courseName}`,
      cta:   'View their profile',
    }
  },

  bookingAnnouncement: (firstName: string, date: string, time: string, memberId?: string): PushPayload => {
    const first = titleCaseName(firstName)
    return {
      title: `${first} is playing ${date}`,
      body:  `${first} booked a tee time at ${time}. Message them to join.`,
      url:   memberId ? `/members/${memberId}` : '/members',
      tag:   `booking-${date}`,
      subject: `${first} is playing on ${date}`,
      cta:   'See who else is playing',
    }
  },

  visitingMember: (firstName: string, lastName: string, from: string, until: string, memberId?: string): PushPayload => {
    const full = titleCaseName(`${firstName} ${lastName}`)
    return {
      title: `${full} is visiting`,
      body:  `Visiting from ${from} to ${until}. Tap to invite them to play.`,
      url:   memberId ? `/members/${memberId}` : '/members',
      // Lower-cased on purpose: the tag is a dedup key, not copy.
      tag:   `visit-${firstName.toLowerCase()}`,
      subject: `${full} is visiting from ${from}`,
      cta:   'Invite them to play',
    }
  },

  newMessage: (senderName: string, preview: string, conversationId: string): PushPayload => {
    // As a push this reads like a chat notification — the sender's name over
    // the message. As an email the same two lines become the heading and the
    // body, which is why the title is the name rather than "New message".
    const sender = titleCaseName(senderName)
    return {
      title: sender,
      body:  preview.length > 80 ? preview.slice(0, 80) + '…' : preview,
      url:   `/messages/${conversationId}`,
      tag:   `msg-${conversationId}`,
      subject: `${sender} sent you a message`,
      cta:   'Reply in LinkUp',
    }
  },

  focusLinkup: (title: string, date: string, weeksOut: number): PushPayload => ({
    title: `${weeksOut === 2 ? '2 weeks' : '1 week'} away: ${title}`,
    body:  `The ${title} is coming up on ${date}. Book your spot now.`,
    url:   '/more/focus-linkups',
    tag:   `focus-linkup-${weeksOut}w`,
    subject: `${title} is ${weeksOut === 2 ? 'two weeks' : 'one week'} away`,
    cta:   'Book your spot',
  }),

  playSuggestion: (otherMemberName: string, suggestedMemberId?: string): PushPayload => {
    const other = titleCaseName(otherMemberName)
    return {
      title: `Play with ${other}?`,
      body:  `You haven't played with ${other} yet. Want to set up a round?`,
      url:   suggestedMemberId ? `/members/${suggestedMemberId}` : '/members',
      // Lower-cased on purpose: the tag is a dedup key, not copy.
      tag:   `suggestion-${otherMemberName.toLowerCase().replace(' ', '-')}`,
      subject: `A round with ${other}?`,
      cta:   'See their profile',
    }
  },

  guestAccessApproved: (courseName: string, from: string, until: string): PushPayload => ({
    title: 'Guest access approved',
    body:  `Your request to visit ${courseName} from ${from} to ${until} has been approved.`,
    url:   '/more/guest-access',
    tag:   'guest-access',
    subject: `Your guest access to ${courseName} is approved`,
    cta:   'View your guest access',
  }),

  referralPartnerApproved: (percentage: number): PushPayload => ({
    title: 'You\'re now a referral partner',
    body:  `Your application was approved — you'll earn ${percentage}% commission on every referral who joins.`,
    url:   '/partner',
    tag:   'referral-partner-approved',
    subject: 'You\'re now a LinkUp referral partner',
    cta:   'Open your partner dashboard',
  }),

  referralListImported: (imported: number, total: number): PushPayload => ({
    title: 'Your referral list was imported',
    body:  imported === total
      ? `All ${total} referral${total !== 1 ? 's' : ''} are now attributed to you.`
      : `${imported} of ${total} referrals were added — open the list to see why the rest weren't.`,
    url:   '/partner/submissions',
    tag:   'referral-list-imported',
    subject: 'Your referral list has been imported',
    cta:   'View your submissions',
  }),

  referralListRejected: (reason: string): PushPayload => ({
    title: 'Referral list not imported',
    body:  reason,
    url:   '/partner/submissions',
    tag:   'referral-list-rejected',
    subject: 'Your referral list could not be imported',
    cta:   'View your submissions',
  }),

  // A credit payout is spendable immediately, so point the partner at the
  // wallet rather than at the payout history.
  referralCommissionPaid: (amount: number, method: PayoutMethod = 'credit'): PushPayload => {
    const formatted = amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
    const settled =
      method === 'credit' ? 'added to your credit balance — spend it on golf'
        : method === 'coupon' ? 'issued as a coupon'
        : 'paid'
    return {
      title: 'Commission paid',
      body:  `A referral commission payout of ${formatted} has been ${settled}.`,
      url:   method === 'credit' ? '/partner/credits' : '/partner/payments',
      tag:   'referral-commission-paid',
      subject: `Your ${formatted} referral commission has been paid`,
      cta:   method === 'credit' ? 'View your credit' : 'View your payment',
    }
  },

  referralPartnerRejected: (reason: string): PushPayload => ({
    title: 'Referral partner application',
    body:  `Your application wasn't approved this time. ${reason}`,
    url:   '/more/referral-partner',
    tag:   'referral-partner-rejected',
    subject: 'About your LinkUp referral partner application',
    cta:   'View details',
  }),

  referralJoined: (referredName: string): PushPayload => {
    const referred = titleCaseName(referredName)
    return {
      title: `${referred} has joined!`,
      body:  `Your referral ${referred} is now a member. Book your introductory round together.`,
      url:   '/more/referrals',
      tag:   'referral-joined',
      subject: `${referred} has joined LinkUp`,
      cta:   'View your referrals',
    }
  },

  announcementBroadcast: (title: string, body: string, type = 'admin_broadcast', announcementId?: string): PushPayload => ({
    title: title.length > 60 ? title.slice(0, 60) + '…' : title,
    body:  body.length > 150 ? body.slice(0, 150) + '…' : body,
    url:   announcementId ? `/more/announcements/${announcementId}` : '/more/announcements',
    tag:   `announcement-${type}`,
    subject: `LinkUp announcement: ${title.length > 60 ? title.slice(0, 60) + '…' : title}`,
    cta:   'Read the announcement',
  }),

  promotionAvailable: (partnerName: string, promoTitle: string, promotionId?: string): PushPayload => ({
    title: `New offer: ${promoTitle.length > 50 ? promoTitle.slice(0, 50) + '…' : promoTitle}`,
    body:  `${partnerName} has a new exclusive offer for LinkUp members.`,
    url:   promotionId ? `/more/promotions/${promotionId}` : '/more/promotions',
    tag:   `promotion-${partnerName.toLowerCase().replace(/\s+/g, '-').slice(0, 20)}`,
    subject: `A new offer from ${partnerName}`,
    cta:   'See the offer',
  }),

  memberActivated: (firstName: string): PushPayload => ({
    title: `Welcome to LinkUp Golf, ${titleCaseName(firstName)}!`,
    body:  'Your membership is now active. Explore the community, book a tee time, and connect with members.',
    url:   '/home',
    tag:   'member-activated',
    subject: `Welcome to LinkUp Golf, ${titleCaseName(firstName)}`,
    cta:   'Open LinkUp',
  }),

  bookingInvite: (bookerFirstName: string, date: string, time: string): PushPayload => ({
    title: `${titleCaseName(bookerFirstName)} invited you to play`,
    body:  `You've been added to a tee time on ${date} at ${time}. Check My Bookings for details.`,
    url:   '/book',
    tag:   'booking-invite',
    subject: `${titleCaseName(bookerFirstName)} added you to a tee time on ${date}`,
    cta:   'View the tee time',
  }),

  bookingPaymentReady: (date: string, time: string): PushPayload => ({
    title: 'Your tee time is confirmed — pay now',
    body:  `Your booking on ${date} at ${time} is ready for payment. Tap to complete your booking.`,
    url:   '/book',
    tag:   'payment-ready',
    subject: `Your tee time on ${date} is ready for payment`,
    cta:   'Pay for your round',
  }),

  // Sent once a round has finished, by the booking-surveys cron. Opening the
  // app is enough — the survey prompt is already due, so it appears on whatever
  // screen loads without needing a dedicated page.
  roundSurvey: (courseName: string, bookingId: string): PushPayload => ({
    title: 'How was your round?',
    body:  `Rate your round at ${courseName} — it only takes a moment.`,
    url:   '/home',
    tag:   `booking-survey-${bookingId}`,
    subject: `How was your round at ${courseName}?`,
    cta:   'Rate your round',
  }),

  groupChatInvite: (inviterFirstName: string, groupName: string, conversationId: string): PushPayload => ({
    title: `${titleCaseName(inviterFirstName)} invited you to a group`,
    body:  `You've been invited to join "${groupName}". Tap to accept or decline.`,
    url:   `/messages/${conversationId}`,
    tag:   `group-invite-${conversationId}`,
    subject: `${titleCaseName(inviterFirstName)} invited you to "${groupName}" on LinkUp`,
    cta:   'Accept or decline',
  }),

  memberEventRejected: (eventTitle: string, reason: string): PushPayload => ({
    title: 'Event submission not approved',
    body:  `Your event "${eventTitle}" wasn't approved. Reason: ${reason}`,
    url:   '/more/events',
    tag:   'member-event-rejected',
    subject: `About your event "${eventTitle}"`,
    cta:   'View your events',
  }),

  // ---- Hosts ------------------------------------------------
  hostApplicationApproved: (): PushPayload => ({
    title: 'You\'re now a host',
    body:  'Your application was approved — create your first event and start earning credits.',
    url:   '/host',
    tag:   'host-application-approved',
    subject: 'You\'re now a LinkUp host',
    cta:   'Open your host workspace',
  }),

  hostApplicationRejected: (reason: string): PushPayload => ({
    title: 'Host application',
    body:  `Your application wasn't approved this time. ${reason}`,
    url:   '/more/host',
    tag:   'host-application-rejected',
    subject: 'About your LinkUp host application',
    cta:   'View details',
  }),

  hostedEventPublished: (courseName: string, date: string): PushPayload => ({
    title: 'Your event is live',
    body:  `Your event at ${courseName} on ${date} is now open for members to reserve spots.`,
    url:   '/host/events',
    tag:   'hosted-event-created',
    subject: `Your ${courseName} event on ${date} is live`,
    cta:   'View the round',
  }),

  // Sent to admins when a host's event goes live. Events publish without
  // waiting for approval, so this is the after-the-fact heads-up that gives an
  // admin the chance to reject one that shouldn't have gone out.
  // Sent to admins when a host submits an event. It is not live — it sits in
  // 'pending_approval' until someone sets up the GHL calendar and approves it,
  // so this is a queue item to action, not an FYI about something already out.
  // A host asking to run a round. Nothing is visible to members until an admin
  // approves it, so this push is the only thing that says there's a queue.
  // `dateCount` covers the batch case: a host picks their dates in one go, and
  // naming only the first would understate what's waiting.
  hostedEventNeedsReview: (
    hostName: string,
    courseName: string,
    date: string,
    dateCount = 1,
  ): PushPayload => ({
    title: 'A host wants to run a round',
    body: dateCount > 1
      ? `${titleCaseName(hostName)} wants to host ${dateCount} rounds at ${courseName}, from ${date}. Set up the calendar, then approve them to put them in front of members.`
      : `${titleCaseName(hostName)} wants to host a round at ${courseName} on ${date}. Set up the calendar, then approve it to put it in front of members.`,
    url:   '/admin/hosts',
    tag:   'hosted-event-review',
    subject: `${titleCaseName(hostName)} wants to host a round at ${courseName}`,
    cta:   'Review it now',
  }),

  // Sent to the host when an admin publishes their event. Until this lands the
  // event exists but no member can see it, so this is the one that matters.
  hostedEventApproved: (courseName: string, date: string): PushPayload => ({
    title: 'Your event is live',
    body:  `Your ${courseName} event on ${date} has been approved — members can reserve a spot now.`,
    url:   '/host/events',
    tag:   'hosted-event-approved',
    subject: `Your ${courseName} event on ${date} is live`,
    cta:   'View your round',
  }),

  // Sent to the host who proposed a venue when an admin approves it, and only
  // when nothing else already told them. A host with rounds there hears about
  // the rounds instead — "your Sept 10 round is live" says everything this does
  // and more, and two pushes for one approval is one too many.
  venueApproved: (courseName: string): PushPayload => ({
    title: 'Your venue is live',
    body:  `${courseName} is set up on LinkUp — you can list rounds there now.`,
    url:   '/host/events',
    tag:   'venue-approved',
    subject: `${courseName} is live on LinkUp`,
    cta:   'View the venue',
  }),

  // Sent when a venue goes live but some of the dates the host asked for can't
  // go with it. They picked those dates before the venue had a calendar to ask,
  // so this is the first moment anyone could know — and it needs the host to
  // pick again, which is why it says so rather than going quiet.
  hostedEventDatesHeld: (courseName: string, count: number): PushPayload => ({
    title: count === 1 ? 'One date needs changing' : `${count} dates need changing`,
    body:  count === 1
      ? `${courseName} is live, but the date you asked for has nothing open. Pick another and we'll put it in front of members.`
      : `${courseName} is live, but ${count} of the dates you asked for have nothing open. Pick others and we'll put them in front of members.`,
    url:   '/host/events',
    tag:   'hosted-event-dates-held',
    subject: `${count === 1 ? 'A date' : `${count} dates`} at ${courseName} need changing`,
    cta:   'Review your dates',
  }),

  // Sent to the host when an admin takes their event down. It's cancelled,
  // not parked — so the host's route back is a new event, not a republish.
  hostedEventRejected: (courseName: string, date: string, reason: string): PushPayload => ({
    title: 'Your event was taken down',
    body:  `Your ${courseName} event on ${date} was taken down and anyone who reserved has been released. ${reason}`,
    url:   '/host/events',
    tag:   'hosted-event-rejected',
    subject: `Your ${courseName} event on ${date} was taken down`,
    cta:   'View details',
  }),

  hostedEventJoined: (memberName: string, courseName: string, date: string): PushPayload => ({
    title: 'New reservation',
    body:  `${titleCaseName(memberName)} reserved a spot at your ${courseName} event on ${date}.`,
    url:   '/host/events',
    tag:   'hosted-event-joined',
    subject: `${titleCaseName(memberName)} reserved a spot at your ${courseName} event`,
    cta:   'View your event',
  }),

  hostedEventProofSubmitted: (hostName: string, courseName: string, date: string): PushPayload => ({
    title: 'Event proof submitted',
    body:  `${titleCaseName(hostName)} uploaded proof for their ${courseName} event on ${date}. Review it to approve credits.`,
    url:   '/admin/hosts',
    tag:   'hosted-event-proof',
    subject: `${titleCaseName(hostName)} submitted proof for ${courseName}`,
    cta:   'Review the proof',
  }),

  hostCreditApproved: (amount: number): PushPayload => ({
    title: 'Credits awarded',
    body:  `${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} in host credits has been added to your balance.`,
    url:   '/host/credits',
    tag:   'host-credit-approved',
    subject: `${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} in host credits has been added`,
    cta:   'View your credit',
  }),

  hostCreditRejected: (reason: string): PushPayload => ({
    title: 'Event credits not approved',
    body:  `Your event's credits weren't approved. ${reason} You can upload new proof.`,
    url:   '/host/events',
    tag:   'host-credit-rejected',
    subject: 'About the credits for your LinkUp event',
    cta:   'View details',
  }),

  // Credit is redeemed toward golf — the membership option went when redeeming
  // came to require a membership, so there's no longer a "which" to state.
  // The 'host-credit' tag prefix is what types these in the notification log
  // (see TAG_TYPE_MAP) — keep it even though credit is no longer host-only.
  creditRedeemed: (amount: number): PushPayload => ({
    title: 'Credits redeemed',
    body:  `You redeemed ${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} in credits toward golf.`,
    url:   '/host/credits',
    tag:   'host-credit-redeemed',
    subject: `You redeemed ${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} in LinkUp credits`,
    cta:   'View your wallet',
  }),

  // A code is the whole point of issuing one, so it goes in the notification
  // body: the member can copy it from here without reopening the app.
  creditCouponIssued: (amount: number, code: string): PushPayload => ({
    title: 'Your credit code is ready',
    body:  `${code} — ${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} off at checkout.`,
    url:   '/host/credits',
    tag:   'host-credit-coupon',
    subject: `Your ${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} LinkUp credit code`,
    cta:   'Get your code',
  }),

  // Sent to admins — a redemption isn't settled until someone puts it against a
  // round for them.
  creditRedemptionRequested: (name: string, amount: number): PushPayload => ({
    title: 'Credit redemption to settle',
    body:  `${titleCaseName(name)} redeemed ${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} toward golf.`,
    url:   '/admin/hosts',
    tag:   'host-credit-redemption',
    subject: `${titleCaseName(name)} redeemed ${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} in credits`,
    cta:   'Review the request',
  }),

  // Sent to members who had reserved a spot when the host cancels the event.
  hostedEventCancelled: (courseName: string, date: string, reason?: string): PushPayload => ({
    title: 'A hosted event was cancelled',
    body:  `The ${courseName} event on ${date} has been cancelled.${reason ? ` ${reason}` : ''} Your spot has been released.`,
    url:   '/book',
    tag:   'hosted-event-cancelled',
    subject: `The ${courseName} event on ${date} was cancelled`,
    cta:   'Find another round',
  }),

  // Sent to members who had reserved a spot when the host changes event details.
  hostedEventUpdated: (courseName: string, date: string): PushPayload => ({
    title: 'A hosted event was updated',
    body:  `Details changed for the ${courseName} event on ${date}. Open it to see the latest.`,
    url:   '/book',
    tag:   'hosted-event-updated',
    subject: `The ${courseName} event on ${date} has changed`,
    cta:   'See what changed',
  }),

  // Sent to the host when a member releases their spot.
  hostedEventMemberCancelled: (memberName: string, courseName: string, date: string): PushPayload => ({
    title: 'A spot opened up',
    body:  `${titleCaseName(memberName)} released their spot at your ${courseName} event on ${date}.`,
    url:   '/host/events',
    tag:   'hosted-event-joined',
    subject: `A spot opened up at your ${courseName} event on ${date}`,
    cta:   'View your event',
  }),
}
