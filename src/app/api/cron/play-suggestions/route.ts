// ============================================================
// GET /api/cron/play-suggestions
// Runs weekly via Vercel Cron (configure in vercel.json).
// For each active member, finds community members they have
// never played with and creates a suggestion record.
// Skips pairs that have been dismissed in the last 90 days.
// ============================================================

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase-server'
import { sendPushToMember, NotificationTemplates } from '@/lib/push'

export async function GET(request: NextRequest) {
  // Verify this is called by Vercel Cron (not a public user)
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const supabase = createAdminClient()
  let suggestionsCreated = 0
  let notificationsSent = 0

  // Get all active courses
  const { data: courses } = await supabase
    .from('courses')
    .select('id')
    .eq('active', true)

  if (!courses?.length) return NextResponse.json({ message: 'No active courses' })

  for (const course of courses) {
    // Get all active members in this course
    const { data: members } = await supabase
      .from('course_memberships')
      .select('member_id, members(id, first_name, last_name)')
      .eq('course_id', course.id)
      .eq('status', 'active')

    if (!members?.length) continue

    const memberIds = members.map(m => m.member_id)

    // For each member, find who they haven't played with
    for (const memberRow of members) {
      const memberId = memberRow.member_id
      const member = memberRow.members as any

      // Get list of members this person HAS played with
      const { data: playedWith } = await supabase
        .from('play_history')
        .select('played_with')
        .eq('member_id', memberId)
        .eq('course_id', course.id)

      const playedWithIds = new Set<string>()
      playedWith?.forEach(row => {
        row.played_with?.forEach((id: string) => playedWithIds.add(id))
      })

      // Get suggestions already dismissed in last 90 days
      const ninetyDaysAgo = new Date()
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

      const { data: dismissed } = await supabase
        .from('play_suggestions')
        .select('suggested_id')
        .eq('member_id', memberId)
        .eq('dismissed', true)
        .gte('dismissed_at', ninetyDaysAgo.toISOString())

      const dismissedIds = new Set(dismissed?.map(d => d.suggested_id) ?? [])

      // Get existing un-dismissed suggestions (don't re-create)
      const { data: existing } = await supabase
        .from('play_suggestions')
        .select('suggested_id')
        .eq('member_id', memberId)
        .eq('dismissed', false)

      const existingIds = new Set(existing?.map(e => e.suggested_id) ?? [])

      // Find candidates: active members in course, not played with, not dismissed, not already suggested
      const candidates = memberIds.filter(id =>
        id !== memberId &&
        !playedWithIds.has(id) &&
        !dismissedIds.has(id) &&
        !existingIds.has(id)
      )

      if (candidates.length === 0) continue

      // Pick one random candidate to suggest
      const pick = candidates[Math.floor(Math.random() * candidates.length)]

      // Upsert the suggestion
      const { error } = await supabase
        .from('play_suggestions')
        .upsert({
          member_id: memberId,
          suggested_id: pick,
          dismissed: false,
        }, {
          onConflict: 'member_id,suggested_id',
        })

      if (!error) {
        suggestionsCreated++

        // Get the suggested member's name for the notification
        const suggested = members.find(m => m.member_id === pick)?.members as any
        if (suggested && member) {
          const { sent } = await sendPushToMember(
            memberId,
            NotificationTemplates.playSuggestion(`${suggested.first_name} ${suggested.last_name}`)
          )
          notificationsSent += sent
        }
      }
    }
  }

  return NextResponse.json({
    message: 'Play suggestions generated',
    suggestionsCreated,
    notificationsSent,
  })
}
