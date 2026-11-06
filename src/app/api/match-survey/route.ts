export const dynamic = 'force-dynamic'

// GET /api/match-survey — the member's answers, and whether they must still
//   complete the survey before using the app (MatchSurveyGate reads this).
// PUT /api/match-survey — the whole survey. Pick-lists go to
//   member_match_profiles, the free text back to member_profiles.
//
// Service role for both: member_match_profiles has RLS on and no policies,
// since gender, habits and preferences must never be readable by another
// member. The member id always comes from the session.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { getCache } from '@/lib/cache'
import { MEMBER_DETAIL_NS, memberDetailKey } from '@/lib/cache/keys'
import { hasMembershipTag } from '@/lib/ghl/tags'
import { logActivity } from '@/lib/activity/log'
import { logger } from '@/lib/logger'
import { requiresMatchSurvey, toMatchProfile, validateSurvey } from '@/lib/matching/survey'
import type { AuthContext } from '@/lib/auth/types'

// Guests are let through so the gate gets an answer ("not required") rather
// than a 403 it would have to interpret.
export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const admin = createAdminClient()
  const [memberRes, profileRes, matchRes] = await Promise.all([
    admin.from('members').select('home_course_id, membership_status, ghl_tags').eq('id', ctx.userId).maybeSingle(),
    admin
      .from('member_profiles')
      .select('value_offered, value_sought, handicap_index, non_golf_hobbies, nonprofits')
      .eq('id', ctx.userId)
      .maybeSingle(),
    admin.from('member_match_profiles').select('*').eq('member_id', ctx.userId).maybeSingle(),
  ])

  if (memberRes.error || matchRes.error) {
    logger.error('Match survey read failed', {
      action: 'match_survey.read',
      errorMessage: memberRes.error?.message ?? matchRes.error?.message,
    })
    return NextResponse.json({ error: 'Could not load your survey.' }, { status: 500 })
  }

  const member = memberRes.data
  const match = toMatchProfile(matchRes.data)
  const required = member
    ? requiresMatchSurvey({
        home_course_id: member.home_course_id,
        membership_status: member.membership_status,
        hasMembership: hasMembershipTag(member.ghl_tags ?? []),
      })
    : false

  return NextResponse.json({
    required,
    completed: Boolean(match.completed_at),
    answers: {
      ...match,
      value_offered: profileRes.data?.value_offered ?? null,
      value_sought: profileRes.data?.value_sought ?? null,
      handicap_index: profileRes.data?.handicap_index ?? null,
      non_golf_hobbies: profileRes.data?.non_golf_hobbies ?? null,
      nonprofits: profileRes.data?.nonprofits ?? [],
    },
  })
}, { allowGuests: true })

export const PUT = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = await req.json().catch(() => null)
  const result = validateSurvey(body)
  if (!result.valid || !result.match || !result.profile) {
    return NextResponse.json({ error: result.errors[0], errors: result.errors }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: existing, error: readError } = await admin
    .from('member_match_profiles')
    .select('completed_at')
    .eq('member_id', ctx.userId)
    .maybeSingle()
  if (readError) {
    return NextResponse.json({ error: 'Could not save your survey. Please try again.' }, { status: 500 })
  }

  const now = new Date().toISOString()
  // The first submission is the one the queue orders by; later edits don't
  // send a member back to the front of it.
  const completedAt = existing?.completed_at ?? now

  const { error: matchError } = await admin.from('member_match_profiles').upsert({
    member_id: ctx.userId,
    ...result.match,
    completed_at: completedAt,
    updated_at: now,
  }, { onConflict: 'member_id' })
  if (matchError) {
    logger.error('Match survey save failed', { action: 'match_survey.save', errorMessage: matchError.message })
    return NextResponse.json({ error: 'Could not save your survey. Please try again.' }, { status: 500 })
  }

  const { error: profileError } = await admin
    .from('member_profiles')
    .update({ ...result.profile, updated_at: now })
    .eq('id', ctx.userId)
  if (profileError) {
    // The survey half is saved, so the gate lifts; the profile text is what
    // didn't land, and the member can see it on their profile.
    logger.warn('Match survey profile fields not saved', {
      action: 'match_survey.profile',
      errorMessage: profileError.message,
    })
  }

  // Other members see what they offer and seek on their profile.
  await getCache(MEMBER_DETAIL_NS).delete(memberDetailKey(ctx.userId)).catch(() => {})

  if (!existing?.completed_at) {
    void logActivity({ memberId: ctx.userId, action: 'match_survey_completed', courseId: ctx.homeCourseId })
  }

  return NextResponse.json({ completed: true, completedAt })
})
