// ============================================================
// GET /api/cron/daily
// Runs daily at midnight via Vercel Cron.
// Handles:
//   1. Expire guest course memberships past valid_until date
//   2. Send Focus LinkUp notifications (2-week and 1-week)
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendPushToMembers, NotificationTemplates } from '@/lib/push'
import { format, addDays, differenceInDays } from 'date-fns'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const today = format(new Date(), 'yyyy-MM-dd')
  const results: Record<string, number> = {}

  // ---- 1. Expire guest memberships ----------------------------
  const { data: expiredGuests, error: expireError } = await supabase
    .from('course_memberships')
    .update({ status: 'expired' })
    .eq('access_type', 'guest')
    .eq('status', 'active')
    .lt('valid_until', today)
    .select('member_id, course_id')

  results.guestAccessExpired = expiredGuests?.length ?? 0

  // Also expire the guest access request records
  if (expiredGuests?.length) {
    for (const expired of expiredGuests) {
      await supabase
        .from('guest_access_requests')
        .update({ status: 'denied' }) // treated as expired
        .eq('requesting_member_id', expired.member_id)
        .eq('target_course_id', expired.course_id)
        .eq('status', 'approved')
        .lt('visit_until', today)
    }
  }

  // ---- 2. Focus LinkUp notifications --------------------------

  // Find Focus LinkUps happening in exactly 14 days
  const in14Days = format(addDays(new Date(), 14), 'yyyy-MM-dd')
  const { data: linkups14 } = await supabase
    .from('focus_linkups')
    .select('id, title, focus_date, tee_time, industry_focus, course_id')
    .eq('focus_date', in14Days)
    .eq('notification_sent_2w', false)

  let notifs2w = 0
  for (const linkup of linkups14 ?? []) {
    const memberIds = await getSubscribedMemberIds(supabase, linkup.course_id, linkup.industry_focus)
    if (memberIds.length > 0) {
      const dateLabel = format(new Date(linkup.focus_date + 'T12:00:00'), 'MMMM d')
      const { sent } = await sendPushToMembers(
        memberIds,
        NotificationTemplates.focusLinkup(linkup.title, dateLabel, 2)
      )
      notifs2w += sent
    }
    await supabase
      .from('focus_linkups')
      .update({ notification_sent_2w: true })
      .eq('id', linkup.id)
  }
  results.focusNotifications2w = notifs2w

  // Find Focus LinkUps happening in exactly 7 days
  const in7Days = format(addDays(new Date(), 7), 'yyyy-MM-dd')
  const { data: linkups7 } = await supabase
    .from('focus_linkups')
    .select('id, title, focus_date, tee_time, industry_focus, course_id')
    .eq('focus_date', in7Days)
    .eq('notification_sent_1w', false)

  let notifs1w = 0
  for (const linkup of linkups7 ?? []) {
    const memberIds = await getSubscribedMemberIds(supabase, linkup.course_id, linkup.industry_focus)
    if (memberIds.length > 0) {
      const dateLabel = format(new Date(linkup.focus_date + 'T12:00:00'), 'MMMM d')
      const { sent } = await sendPushToMembers(
        memberIds,
        NotificationTemplates.focusLinkup(linkup.title, dateLabel, 1)
      )
      notifs1w += sent
    }
    await supabase
      .from('focus_linkups')
      .update({ notification_sent_1w: true })
      .eq('id', linkup.id)
  }
  results.focusNotifications1w = notifs1w

  // ---- 3. Message notifications (new messages while offline) --
  // Supabase Realtime handles live delivery; this is a fallback
  // for members who weren't connected in the last 30 minutes.
  // Skipped in v1 — Realtime is sufficient for launch.

  console.log('Daily cron results:', results)
  return NextResponse.json({ message: 'Daily cron complete', results })
}

// ---- Helper: get member IDs subscribed to any of a set of categories

async function getSubscribedMemberIds(
  supabase: ReturnType<typeof createAdminClient>,
  courseId: string,
  industryFocus: string[]
): Promise<string[]> {
  // Get members subscribed to any of the focus categories AND active in this course
  const { data: subscriptions } = await supabase
    .from('focus_linkup_subscriptions')
    .select('member_id')
    .in('industry_focus', industryFocus)

  if (!subscriptions?.length) return []

  const subscribedIds = subscriptions.map(s => s.member_id)

  const { data: activeMembers } = await supabase
    .from('course_memberships')
    .select('member_id')
    .eq('course_id', courseId)
    .eq('status', 'active')
    .in('member_id', subscribedIds)

  return activeMembers?.map(m => m.member_id) ?? []
}
