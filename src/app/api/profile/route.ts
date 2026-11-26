export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient } from '@/lib/supabase-server'
import { getCache } from '@/lib/cache'
import { MEMBER_DETAIL_NS, memberDetailKey } from '@/lib/cache/keys'
import { parseNonprofits, MAX_NONPROFITS } from '@/lib/profile/nonprofits'
import { syncedChanges } from '@/lib/ghl/profile-fields'
import { pushProfileToGhl, GhlProfileSyncError } from '@/lib/sync/profile.push'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

/** Shown when GoHighLevel can't take the change: nothing was saved, so trying again is safe. */
const GHL_SAVE_ERROR = "Your changes couldn't be saved just now. Nothing was changed — please try again in a minute."

export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())

  const { data, error } = await supabase
    .from('member_profiles')
    .select('*')
    .eq('id', ctx.userId)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}, { allowGuests: true })

export const PATCH = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const supabase = createRouteHandlerClient(cookies())
  const body = await req.json() as Record<string, unknown>

  // Whitelist updatable fields — prevent overwriting id or system fields
  const allowed = [
    'display_name', 'avatar_url', 'business_name', 'business_description',
    'role_title', 'industry_category', 'value_offered', 'value_sought',
    'non_golf_hobbies', 'golfer_description', 'linkedin_url', 'handicap_index', 'preferred_play_times',
    'play_frequency', 'open_to_golf_travel', 'family_golfers',
    'profile_visible', 'show_handicap', 'text_size',
  ]

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  // Handled outside the whitelist loop: the client sends the textarea's raw
  // text and the stored shape is an array, so this is a parse rather than a
  // copy. Rejecting a fourth entry rather than dropping it — the member typed
  // it deliberately, and silently deleting a line they can still see in the
  // box reads as the save having failed. The DB CHECK enforces the same cap;
  // this exists so the answer is a sentence instead of a constraint violation.
  if ('nonprofits' in body) {
    const parsed = parseNonprofits(body.nonprofits as string | string[] | null)
    if (parsed.length > MAX_NONPROFITS) {
      return NextResponse.json(
        { error: `Please list up to ${MAX_NONPROFITS} non-profits — you have ${parsed.length}.` },
        { status: 400 }
      )
    }
    updates.nonprofits = parsed
  }

  // Organization, title, LinkedIn and non-profits are held in GoHighLevel too.
  // Write a change there first: if it can't be written, refuse the save, since
  // the next GHL → app sync would otherwise put the old value back.
  // The contact id comes from the auth context, which withAuth already loaded
  // through the service role. Reading it here through the member's own session
  // could come back empty under RLS, and an empty id used to skip GHL silently
  // while the save went ahead (2026-11-26: a title change never reached GHL).
  const current = await supabase.from('member_profiles')
    .select('business_name, role_title, linkedin_url, nonprofits')
    .eq('id', ctx.userId).single()
  const changes = syncedChanges(current.data ?? {}, updates)
  const contactId = ctx.ghlContactId
  if (!contactId && Object.keys(changes).length > 0) {
    logger.warn('Profile fields changed for a member with no GHL contact — not synced', {
      action: 'ghl_profile_push', userId: ctx.userId, metadata: { fields: Object.keys(changes) },
    })
  }
  if (contactId && Object.keys(changes).length > 0) {
    try {
      await pushProfileToGhl(contactId, changes)
    } catch (err) {
      if (err instanceof GhlProfileSyncError) return NextResponse.json({ error: GHL_SAVE_ERROR }, { status: 502 })
      throw err
    }
  }

  const { data, error } = await supabase
    .from('member_profiles')
    .update(updates)
    .eq('id', ctx.userId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Invalidate the cached member detail so other members see the updated profile.
  await getCache(MEMBER_DETAIL_NS).delete(memberDetailKey(ctx.userId)).catch(() => {})

  return NextResponse.json(data)
}, { allowGuests: true })
