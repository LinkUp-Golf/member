export const dynamic = 'force-dynamic'

// GET   /api/match-survey — the member's Curated Introductions answers, whether
//   they can use it at all (`eligible`), whether they've answered it
//   (`completed`), and whether it's on (`enabled`).
// PUT   /api/match-survey — the whole survey; saving it turns Curated
//   Introductions on. Pick-lists go to member_match_profiles, what they offer
//   and seek back to member_profiles.
// PATCH /api/match-survey — { enabled }: the "Turn on Curated Introductions"
//   switch, for a member who has already answered. Off takes them out of other
//   members' lists and stops introductions to them; their answers are kept.
//
// Service role throughout: member_match_profiles has RLS on and no policies,
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
import { eligibleForIntroductions, toMatchProfile, validateSurvey } from '@/lib/matching/survey'
import type { AuthContext } from '@/lib/auth/types'

// Guests are let through so the page gets an answer ("not eligible") rather
// than a 403 it would have to interpret.
export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const admin = createAdminClient()
  const [memberRes, profileRes, matchRes] = await Promise.all([
    admin.from('members').select('home_course_id, membership_status, ghl_tags').eq('id', ctx.userId).maybeSingle(),
    admin
      .from('member_profiles')
      .select('value_offered, value_sought, industry_category')
      .eq('id', ctx.userId)
      .maybeSingle(),
    admin.from('member_match_profiles').select('*').eq('member_id', ctx.userId).maybeSingle(),
  ])

  if (memberRes.error || matchRes.error) {
    logger.error('Match survey read failed', {
      action: 'match_survey.read',
      errorMessage: memberRes.error?.message ?? matchRes.error?.message,
    })
    return NextResponse.json({ error: 'Could not load your answers.' }, { status: 500 })
  }

  const member = memberRes.data
  const match = toMatchProfile(matchRes.data)
  const eligible = member
    ? eligibleForIntroductions({
        home_course_id: member.home_course_id,
        membership_status: member.membership_status,
        hasMembership: hasMembershipTag(member.ghl_tags ?? []),
      })
    : false
  const completed = Boolean(match.completed_at)

  // Pre-filled from the profile until the survey has its own answer.
  const profileIndustry = profileRes.data?.industry_category ?? null
  const answers = {
    ...match,
    industry: match.industry ?? (toMatchProfile({ industry: profileIndustry }).industry),
    role: match.role ?? (profileIndustry === 'Business Owner / Founder' ? 'founder' : null),
    value_offered: profileRes.data?.value_offered ?? null,
    value_sought: profileRes.data?.value_sought ?? null,
  }

  return NextResponse.json({
    eligible,
    completed,
    enabled: completed && match.open_to_suggestions,
    answers,
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
    return NextResponse.json({ error: 'Could not save your answers. Please try again.' }, { status: 500 })
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
    return NextResponse.json({ error: 'Could not save your answers. Please try again.' }, { status: 500 })
  }

  const { error: profileError } = await admin
    .from('member_profiles')
    .update({ ...result.profile, updated_at: now })
    .eq('id', ctx.userId)
  if (profileError) {
    // The survey half is saved; the profile text is what didn't land, and the
    // member can see it on their profile.
    logger.warn('Match survey profile fields not saved', {
      action: 'match_survey.profile',
      errorMessage: profileError.message,
    })
  }

  // Other members see what they offer and seek on their profile.
  await getCache(MEMBER_DETAIL_NS).delete(memberDetailKey(ctx.userId)).catch(() => {})

  if (!existing?.completed_at) {
    void logActivity({ memberId: ctx.memberId, action: 'match_survey_completed', courseId: ctx.homeCourseId })
  }

  return NextResponse.json({ completed: true, completedAt, enabled: result.match.open_to_suggestions })
})

export const PATCH = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = await req.json().catch(() => null) as { enabled?: unknown } | null
  if (typeof body?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'Missing enabled' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('member_match_profiles')
    .update({ open_to_suggestions: body.enabled, updated_at: new Date().toISOString() })
    .eq('member_id', ctx.userId)
    .not('completed_at', 'is', null)
    .select('open_to_suggestions')
  if (error) {
    logger.error('Curated Introductions switch failed', { action: 'match_survey.toggle', errorMessage: error.message })
    return NextResponse.json({ error: 'Could not change that. Please try again.' }, { status: 500 })
  }
  if (!data || data.length === 0) {
    // Nothing answered yet: turning it on is saving the survey.
    return NextResponse.json({ error: 'Answer the questions below to turn on Curated Introductions.' }, { status: 409 })
  }
  return NextResponse.json({ enabled: data[0]?.open_to_suggestions === true })
})
