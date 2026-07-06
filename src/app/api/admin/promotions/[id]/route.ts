export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { getCache } from '@/lib/cache'
import { COURSE_PROMO_NS, coursePromoPrefix } from '@/lib/cache/keys'
import { activeCourseIds, postAnnouncementToCourses } from '@/lib/announcements/fan-out'
import type { AuthContext } from '@/lib/auth/types'

export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const body = await req.json() as Record<string, unknown>
    const update: Record<string, unknown> = {}

    const stringFields = ['title', 'description', 'partner_name', 'badge_label', 'cta_label']
    const nullableFields = ['cta_url', 'expires_at', 'image_url', 'video_url', 'course_id']
    const rawFields = ['active', 'sort_order', 'media_urls']

    for (const f of stringFields) {
      if (f in body) update[f] = typeof body[f] === 'string' ? (body[f] as string).trim() : body[f]
    }
    for (const f of nullableFields) {
      if (f in body) update[f] = body[f] === '' ? null : body[f]
    }
    for (const f of rawFields) {
      if (f in body) update[f] = body[f]
    }

    const admin = createAdminClient()

    // Fetch prior `active` state so we only announce on the false → true
    // transition, not on every unrelated edit of an already-active promo.
    const wasActivating = update.active === true
    const { data: prior } = wasActivating
      ? await admin.from('promotions').select('active').eq('id', id).single()
      : { data: null }

    const { data, error } = await admin
      .from('promotions')
      .update(update)
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (data.course_id) {
      await getCache(COURSE_PROMO_NS).clear(coursePromoPrefix(data.course_id)).catch(() => {})
    } else {
      await getCache(COURSE_PROMO_NS).clear('course:promo:').catch(() => {})
    }

    if (wasActivating && prior?.active === false) {
      const announcementCourseIds = data.course_id ? [data.course_id] : await activeCourseIds(admin)
      void postAnnouncementToCourses(admin, announcementCourseIds, {
        type: 'promotion',
        authorId: ctx.userId,
        title: data.title,
        body: data.description,
        image_url: data.image_url,
        video_url: data.video_url,
        media_urls: data.media_urls,
        metadata: { promotion_id: data.id },
      }).catch(err => console.error('[promotions/update] Announcement post failed (non-fatal):', err))
    }

    return NextResponse.json(data)
  },
  { requireAdmin: true, skipGHLCheck: true }
)

export const DELETE = withAuth(
  async (_req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const admin = createAdminClient()

    // Fetch course_id before deleting so we can bust the correct cache.
    const { data: existing } = await admin
      .from('promotions')
      .select('course_id')
      .eq('id', id)
      .single()

    const { error } = await admin.from('promotions').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (existing?.course_id) {
      await getCache(COURSE_PROMO_NS).clear(coursePromoPrefix(existing.course_id)).catch(() => {})
    } else {
      // Global promotion — clear all courses.
      await getCache(COURSE_PROMO_NS).clear('course:promo:').catch(() => {})
    }

    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
