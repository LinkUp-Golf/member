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
}
