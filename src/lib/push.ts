// ============================================================
// LinkUp Golf — Push Notification Utility
// Server-side only. Sends Web Push notifications to
// subscribed member devices via the Web Push Protocol.
// ============================================================

// NOTE: Install web-push before using:
// npm install web-push
// npm install --save-dev @types/web-push
//
// Then generate VAPID keys once and store in env:
// node -e "const wp=require('web-push'); const k=wp.generateVAPIDKeys(); console.log(k)"

import webpush from 'web-push'
import { createAdminClient } from '@/lib/supabase-server'

// Configure VAPID (set these env vars after running key generation above)
webpush.setVapidDetails(
  `mailto:${process.env.VAPID_CONTACT_EMAIL ?? 'hello@linkup.golf'}`,
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
)

// ---- Types --------------------------------------------------

export interface PushPayload {
  title: string
  body: string
  icon?: string
  badge?: string
  url?: string          // URL to open when notification is tapped
  tag?: string          // Deduplication tag
}

// ---- Send to a single member --------------------------------

export async function sendPushToMember(
  memberId: string,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  const supabase = createAdminClient()

  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('member_id', memberId)

  if (!subscriptions?.length) return { sent: 0, failed: 0 }

  return sendToSubscriptions(subscriptions, payload)
}

// ---- Send to multiple members -------------------------------

export async function sendPushToMembers(
  memberIds: string[],
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  if (memberIds.length === 0) return { sent: 0, failed: 0 }

  const supabase = createAdminClient()
  const { data: subscriptions } = await supabase
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth, member_id')
    .in('member_id', memberIds)

  if (!subscriptions?.length) return { sent: 0, failed: 0 }

  return sendToSubscriptions(subscriptions, payload)
}

// ---- Send to an entire course community ---------------------

export async function sendPushToCourse(
  courseId: string,
  payload: PushPayload,
  excludeMemberId?: string
): Promise<{ sent: number; failed: number }> {
  const supabase = createAdminClient()

  // Get all active members of the course
  let query = supabase
    .from('course_memberships')
    .select('member_id')
    .eq('course_id', courseId)
    .eq('status', 'active')

  if (excludeMemberId) {
    query = query.neq('member_id', excludeMemberId)
  }

  const { data: members } = await query
  if (!members?.length) return { sent: 0, failed: 0 }

  const memberIds = members.map(m => m.member_id)
  return sendPushToMembers(memberIds, payload)
}

// ---- Core send logic ----------------------------------------

async function sendToSubscriptions(
  subscriptions: Array<{ endpoint: string; p256dh: string; auth: string }>,
  payload: PushPayload
): Promise<{ sent: number; failed: number }> {
  const notification = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: payload.icon ?? '/icons/icon-192.png',
    badge: payload.badge ?? '/icons/icon-192.png',
    data: { url: payload.url ?? '/' },
    tag: payload.tag,
  })

  let sent = 0
  let failed = 0
  const staleEndpoints: string[] = []

  await Promise.allSettled(
    subscriptions.map(async sub => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          notification,
          { TTL: 86400 } // 24 hours
        )
        sent++
      } catch (err: unknown) {
        // 410 Gone = subscription is no longer valid, clean it up
        const statusCode = (err as { statusCode?: number }).statusCode
        if (statusCode === 410 || statusCode === 404) {
          staleEndpoints.push(sub.endpoint)
        }
        failed++
      }
    })
  )

  // Clean up stale subscriptions
  if (staleEndpoints.length > 0) {
    const supabase = createAdminClient()
    await supabase
      .from('push_subscriptions')
      .delete()
      .in('endpoint', staleEndpoints)
  }

  return { sent, failed }
}

// ---- Notification templates ---------------------------------
// Centralised so wording is consistent everywhere

export const NotificationTemplates = {
  newMember: (firstName: string, lastName: string, courseName: string): PushPayload => ({
    title: `New member: ${firstName} ${lastName}`,
    body: `${firstName} has joined the ${courseName} community. Tap to view their profile.`,
    url: '/members',
    tag: 'new-member',
  }),

  bookingAnnouncement: (firstName: string, date: string, time: string): PushPayload => ({
    title: `${firstName} is playing ${date}`,
    body: `${firstName} booked a tee time at ${time}. Message them to join.`,
    url: '/messages',
    tag: `booking-${date}`,
  }),

  visitingMember: (firstName: string, lastName: string, from: string, until: string): PushPayload => ({
    title: `${firstName} ${lastName} is visiting`,
    body: `Visiting from ${from} to ${until}. Tap to invite them to play.`,
    url: '/members',
    tag: `visit-${firstName.toLowerCase()}`,
  }),

  newMessage: (senderName: string, preview: string, conversationId: string): PushPayload => ({
    title: senderName,
    body: preview.length > 80 ? preview.slice(0, 80) + '…' : preview,
    url: `/messages/${conversationId}`,
    tag: `msg-${conversationId}`,
  }),

  focusLinkup: (title: string, date: string, weeksOut: number): PushPayload => ({
    title: `${weeksOut === 2 ? '2 weeks' : '1 week'} away: ${title}`,
    body: `The ${title} is coming up on ${date}. Book your spot now.`,
    url: '/book',
    tag: `focus-linkup-${weeksOut}w`,
  }),

  playSuggestion: (otherMemberName: string): PushPayload => ({
    title: `Play with ${otherMemberName}?`,
    body: `You haven't played with ${otherMemberName} yet. Want to set up a round?`,
    url: '/members',
    tag: `suggestion-${otherMemberName.toLowerCase().replace(' ', '-')}`,
  }),

  guestAccessApproved: (courseName: string, from: string, until: string): PushPayload => ({
    title: 'Guest access approved',
    body: `Your request to visit ${courseName} from ${from} to ${until} has been approved.`,
    url: '/more/guest-access',
    tag: 'guest-access',
  }),

  referralJoined: (referredName: string): PushPayload => ({
    title: `${referredName} has joined!`,
    body: `Your referral ${referredName} is now a member. Book your introductory round together.`,
    url: '/more/referrals',
    tag: 'referral-joined',
  }),
}
