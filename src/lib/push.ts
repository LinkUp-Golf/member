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

// ---- Notification templates ---------------------------------

export const NotificationTemplates = {
  newMember: (firstName: string, lastName: string, courseName: string): PushPayload => ({
    title: `New member: ${firstName} ${lastName}`,
    body:  `${firstName} has joined the ${courseName} community. Tap to view their profile.`,
    url:   '/members',
    tag:   'new-member',
  }),

  bookingAnnouncement: (firstName: string, date: string, time: string): PushPayload => ({
    title: `${firstName} is playing ${date}`,
    body:  `${firstName} booked a tee time at ${time}. Message them to join.`,
    url:   '/messages',
    tag:   `booking-${date}`,
  }),

  visitingMember: (firstName: string, lastName: string, from: string, until: string): PushPayload => ({
    title: `${firstName} ${lastName} is visiting`,
    body:  `Visiting from ${from} to ${until}. Tap to invite them to play.`,
    url:   '/members',
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
    url:   '/book',
    tag:   `focus-linkup-${weeksOut}w`,
  }),

  playSuggestion: (otherMemberName: string): PushPayload => ({
    title: `Play with ${otherMemberName}?`,
    body:  `You haven't played with ${otherMemberName} yet. Want to set up a round?`,
    url:   '/members',
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
}
