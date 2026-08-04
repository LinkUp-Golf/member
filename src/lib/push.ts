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

// ---- sendPushToCourse ---------------------------------------
// Fetches all active member IDs for a course, then dispatches.
// Kept here because it needs a Supabase query that doesn't
// belong in the generic push service.

export async function sendPushToCourse(
  courseId: string,
  payload: PushPayload,
  excludeUserId?: string
): Promise<SendResult> {
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
  if (!members?.length) return { sent: 0, failed: 0, cleaned: 0 }

  const userIds = members.map((m: { member_id: string }) => m.member_id)
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

// Sends to course members whose focus linkup subscriptions overlap with
// focusCategories. Falls back to all course members when the list is empty.
export async function sendPushToFocusMembers(
  courseId: string,
  focusCategories: string[],
  payload: PushPayload,
  excludeUserId?: string
): Promise<SendResult> {
  if (!focusCategories.length) {
    return sendPushToCourse(courseId, payload, excludeUserId)
  }

  const supabase = createAdminClient()

  let memberQuery = supabase
    .from('course_memberships')
    .select('member_id')
    .eq('course_id', courseId)
    .eq('status', 'active')
  if (excludeUserId) memberQuery = memberQuery.neq('member_id', excludeUserId)

  const { data: courseMembers } = await memberQuery
  if (!courseMembers?.length) return { sent: 0, failed: 0, cleaned: 0 }

  const courseMemberIds = courseMembers.map((m: { member_id: string }) => m.member_id)

  const { data: subs } = await supabase
    .from('focus_linkup_subscriptions')
    .select('member_id, industry_focus, custom_label, status')
    .in('member_id', courseMemberIds)

  const subscribedIds = [...new Set(
    (subs ?? [])
      .filter((s: { industry_focus: string; custom_label: string | null; status: string }) => {
        if (focusCategories.includes(s.industry_focus) && s.status !== 'declined') return true
        if (s.custom_label && focusCategories.includes(s.custom_label) && s.status === 'approved') return true
        return false
      })
      .map((s: { member_id: string }) => s.member_id)
  )]

  if (!subscribedIds.length) return { sent: 0, failed: 0, cleaned: 0 }
  return sendToUsers(subscribedIds, payload)
}

// ---- Notification templates ---------------------------------

export const NotificationTemplates = {
  newMember: (firstName: string, lastName: string, courseName: string, memberId?: string): PushPayload => ({
    title: `New member: ${firstName} ${lastName}`,
    body:  `${firstName} has joined the ${courseName} community. Tap to view their profile.`,
    url:   memberId ? `/members/${memberId}` : '/members',
    tag:   'new-member',
  }),

  bookingAnnouncement: (firstName: string, date: string, time: string, memberId?: string): PushPayload => ({
    title: `${firstName} is playing ${date}`,
    body:  `${firstName} booked a tee time at ${time}. Message them to join.`,
    url:   memberId ? `/members/${memberId}` : '/members',
    tag:   `booking-${date}`,
  }),

  visitingMember: (firstName: string, lastName: string, from: string, until: string, memberId?: string): PushPayload => ({
    title: `${firstName} ${lastName} is visiting`,
    body:  `Visiting from ${from} to ${until}. Tap to invite them to play.`,
    url:   memberId ? `/members/${memberId}` : '/members',
    tag:   `visit-${firstName.toLowerCase()}`,
  }),

  newMessage: (senderName: string, preview: string, conversationId: string): PushPayload => ({
    title: senderName,
    body:  preview.length > 80 ? preview.slice(0, 80) + '…' : preview,
    url:   `/messages/${conversationId}`,
    tag:   `msg-${conversationId}`,
  }),

  focusLinkup: (title: string, date: string, weeksOut: number): PushPayload => ({
    title: `${weeksOut === 2 ? '2 weeks' : '1 week'} away: ${title}`,
    body:  `The ${title} is coming up on ${date}. Book your spot now.`,
    url:   '/more/focus-linkups',
    tag:   `focus-linkup-${weeksOut}w`,
  }),

  playSuggestion: (otherMemberName: string, suggestedMemberId?: string): PushPayload => ({
    title: `Play with ${otherMemberName}?`,
    body:  `You haven't played with ${otherMemberName} yet. Want to set up a round?`,
    url:   suggestedMemberId ? `/members/${suggestedMemberId}` : '/members',
    tag:   `suggestion-${otherMemberName.toLowerCase().replace(' ', '-')}`,
  }),

  guestAccessApproved: (courseName: string, from: string, until: string): PushPayload => ({
    title: 'Guest access approved',
    body:  `Your request to visit ${courseName} from ${from} to ${until} has been approved.`,
    url:   '/more/guest-access',
    tag:   'guest-access',
  }),

  referralPartnerApproved: (percentage: number): PushPayload => ({
    title: 'You\'re now a referral partner',
    body:  `Your application was approved — you'll earn ${percentage}% commission on every referral who joins.`,
    url:   '/partner',
    tag:   'referral-partner-approved',
  }),

  referralListImported: (imported: number, total: number): PushPayload => ({
    title: 'Your referral list was imported',
    body:  imported === total
      ? `All ${total} referral${total !== 1 ? 's' : ''} are now attributed to you.`
      : `${imported} of ${total} referrals were added — open the list to see why the rest weren't.`,
    url:   '/partner/submissions',
    tag:   'referral-list-imported',
  }),

  referralListRejected: (reason: string): PushPayload => ({
    title: 'Referral list not imported',
    body:  reason,
    url:   '/partner/submissions',
    tag:   'referral-list-rejected',
  }),

  referralCommissionPaid: (amount: number, method: 'cash' | 'coupon' = 'cash'): PushPayload => ({
    title: 'Commission paid',
    body:  `A referral commission payout of ${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} has been ${method === 'coupon' ? 'issued as a coupon' : 'paid'}.`,
    url:   '/partner/payments',
    tag:   'referral-commission-paid',
  }),

  referralPartnerRejected: (reason: string): PushPayload => ({
    title: 'Referral partner application',
    body:  `Your application wasn't approved this time. ${reason}`,
    url:   '/more/referral-partner',
    tag:   'referral-partner-rejected',
  }),

  referralJoined: (referredName: string): PushPayload => ({
    title: `${referredName} has joined!`,
    body:  `Your referral ${referredName} is now a member. Book your introductory round together.`,
    url:   '/more/referrals',
    tag:   'referral-joined',
  }),

  announcementBroadcast: (title: string, body: string, type = 'admin_broadcast', announcementId?: string): PushPayload => ({
    title: title.length > 60 ? title.slice(0, 60) + '…' : title,
    body:  body.length > 150 ? body.slice(0, 150) + '…' : body,
    url:   announcementId ? `/more/announcements/${announcementId}` : '/more/announcements',
    tag:   `announcement-${type}`,
  }),

  promotionAvailable: (partnerName: string, promoTitle: string, promotionId?: string): PushPayload => ({
    title: `New offer: ${promoTitle.length > 50 ? promoTitle.slice(0, 50) + '…' : promoTitle}`,
    body:  `${partnerName} has a new exclusive offer for LinkUp members.`,
    url:   promotionId ? `/more/promotions/${promotionId}` : '/more/promotions',
    tag:   `promotion-${partnerName.toLowerCase().replace(/\s+/g, '-').slice(0, 20)}`,
  }),

  memberActivated: (firstName: string): PushPayload => ({
    title: `Welcome to LinkUp Golf, ${firstName}!`,
    body:  'Your membership is now active. Explore the community, book a tee time, and connect with members.',
    url:   '/home',
    tag:   'member-activated',
  }),

  bookingInvite: (bookerFirstName: string, date: string, time: string): PushPayload => ({
    title: `${bookerFirstName} invited you to play`,
    body:  `You've been added to a tee time on ${date} at ${time}. Check My Bookings for details.`,
    url:   '/book',
    tag:   'booking-invite',
  }),

  bookingPaymentReady: (date: string, time: string): PushPayload => ({
    title: 'Your tee time is confirmed — pay now',
    body:  `Your booking on ${date} at ${time} is ready for payment. Tap to complete your booking.`,
    url:   '/book',
    tag:   'payment-ready',
  }),

  // Sent once a round has finished, by the booking-surveys cron. Opening the
  // app is enough — the survey prompt is already due, so it appears on whatever
  // screen loads without needing a dedicated page.
  roundSurvey: (courseName: string, bookingId: string): PushPayload => ({
    title: 'How was your round?',
    body:  `Rate your round at ${courseName} — it only takes a moment.`,
    url:   '/home',
    tag:   `booking-survey-${bookingId}`,
  }),

  groupChatInvite: (inviterFirstName: string, groupName: string, conversationId: string): PushPayload => ({
    title: `${inviterFirstName} invited you to a group`,
    body:  `You've been invited to join "${groupName}". Tap to accept or decline.`,
    url:   `/messages/${conversationId}`,
    tag:   `group-invite-${conversationId}`,
  }),

  nonMemberBookingRequest: (bookerName: string, guestCount: number, date: string, time: string): PushPayload => ({
    title: 'Non-member booking request',
    body:  `${bookerName} wants to bring ${guestCount} non-member${guestCount !== 1 ? 's' : ''} to a tee time on ${date} at ${time}. Tap to review.`,
    url:   '/admin/booking-requests',
    tag:   'booking-request',
  }),

  nonMemberBookingApproved: (guestName: string, date: string, time: string): PushPayload => ({
    title: 'Guest approved',
    body:  `${guestName} has been approved to join your tee time on ${date} at ${time}.`,
    url:   '/book',
    tag:   'booking-request-decision',
  }),

  nonMemberBookingRejected: (guestName: string, date: string, time: string): PushPayload => ({
    title: 'Guest request declined',
    body:  `Your request to bring ${guestName} to the tee time on ${date} at ${time} wasn't approved. Tap for details.`,
    url:   '/book',
    tag:   'booking-request-decision',
  }),

  memberEventRejected: (eventTitle: string, reason: string): PushPayload => ({
    title: 'Event submission not approved',
    body:  `Your event "${eventTitle}" wasn't approved. Reason: ${reason}`,
    url:   '/more/events',
    tag:   'member-event-rejected',
  }),

  // ---- Hosts ------------------------------------------------
  hostApplicationApproved: (): PushPayload => ({
    title: 'You\'re now a host',
    body:  'Your application was approved — create your first event and start earning credits.',
    url:   '/host',
    tag:   'host-application-approved',
  }),

  hostApplicationRejected: (reason: string): PushPayload => ({
    title: 'Host application',
    body:  `Your application wasn't approved this time. ${reason}`,
    url:   '/more/host',
    tag:   'host-application-rejected',
  }),

  hostedEventPublished: (courseName: string, date: string): PushPayload => ({
    title: 'Your event is live',
    body:  `Your event at ${courseName} on ${date} is now open for members to reserve spots.`,
    url:   '/host/events',
    tag:   'hosted-event-created',
  }),

  // Sent to admins when a host's event goes live. Events publish without
  // waiting for approval, so this is the after-the-fact heads-up that gives an
  // admin the chance to reject one that shouldn't have gone out.
  hostedEventNeedsReview: (hostName: string, courseName: string, date: string): PushPayload => ({
    title: 'New hosted event is live',
    body:  `${hostName} published an event at ${courseName} on ${date}. Review it if it shouldn't be listed.`,
    url:   '/admin/hosts',
    tag:   'hosted-event-review',
  }),

  // Sent to the host when an admin takes a published event back down.
  hostedEventRejected: (courseName: string, date: string, reason: string): PushPayload => ({
    title: 'Your event was unpublished',
    body:  `Your ${courseName} event on ${date} was taken down. ${reason} Fix it and publish again.`,
    url:   '/host/events',
    tag:   'hosted-event-rejected',
  }),

  hostedEventJoined: (memberName: string, courseName: string, date: string): PushPayload => ({
    title: 'New reservation',
    body:  `${memberName} reserved a spot at your ${courseName} event on ${date}.`,
    url:   '/host/events',
    tag:   'hosted-event-joined',
  }),

  hostedEventProofSubmitted: (hostName: string, courseName: string, date: string): PushPayload => ({
    title: 'Event proof submitted',
    body:  `${hostName} uploaded proof for their ${courseName} event on ${date}. Review it to approve credits.`,
    url:   '/admin/hosts',
    tag:   'hosted-event-proof',
  }),

  hostCreditApproved: (amount: number): PushPayload => ({
    title: 'Credits awarded',
    body:  `${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} in host credits has been added to your balance.`,
    url:   '/host/credits',
    tag:   'host-credit-approved',
  }),

  hostCreditRejected: (reason: string): PushPayload => ({
    title: 'Event credits not approved',
    body:  `Your event's credits weren't approved. ${reason} You can upload new proof.`,
    url:   '/host/events',
    tag:   'host-credit-rejected',
  }),

  hostCreditRedeemed: (amount: number): PushPayload => ({
    title: 'Credits redeemed',
    body:  `You redeemed ${amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })} in host credits.`,
    url:   '/host/credits',
    tag:   'host-credit-redeemed',
  }),

  // Sent to members who had reserved a spot when the host cancels the event.
  hostedEventCancelled: (courseName: string, date: string, reason?: string): PushPayload => ({
    title: 'A hosted event was cancelled',
    body:  `The ${courseName} event on ${date} has been cancelled.${reason ? ` ${reason}` : ''} Your spot has been released.`,
    url:   '/more/hosted-events',
    tag:   'hosted-event-cancelled',
  }),

  // Sent to members who had reserved a spot when the host changes event details.
  hostedEventUpdated: (courseName: string, date: string): PushPayload => ({
    title: 'A hosted event was updated',
    body:  `Details changed for the ${courseName} event on ${date}. Open it to see the latest.`,
    url:   '/more/hosted-events',
    tag:   'hosted-event-updated',
  }),

  // Sent to the host when a member releases their spot.
  hostedEventMemberCancelled: (memberName: string, courseName: string, date: string): PushPayload => ({
    title: 'A spot opened up',
    body:  `${memberName} released their spot at your ${courseName} event on ${date}.`,
    url:   '/host/events',
    tag:   'hosted-event-joined',
  }),
}
