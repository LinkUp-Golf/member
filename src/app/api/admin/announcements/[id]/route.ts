export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { getCache } from '@/lib/cache'
import { COURSE_ANN_NS, courseAnnPrefix } from '@/lib/cache/keys'
import { sendPushToCourse, sendPushToFocusMembers, NotificationTemplates } from '@/lib/push'
import type { AuthContext } from '@/lib/auth/types'

export const PATCH = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const body = await req.json() as {
      title?: string
      body?: string
      type?: string
      status?: string
      image_url?: string | null
      video_url?: string | null
      media_urls?: string[]
      focus_linkup_categories?: string[]
      is_pinned?: boolean
    }

    // Detect moderation approval: status transitioning to 'published'
    const isApproving = body.status === 'published'

    // If approving, check the current status to avoid re-notifying already-published posts
    let wasAlreadyPublished = false
    const admin = createAdminClient()
    if (isApproving) {
      const { data: current } = await admin
        .from('announcements')
        .select('status')
        .eq('id', id)
        .single()
      wasAlreadyPublished = current?.status === 'published'
    }

    const update: Record<string, unknown> = {}
    if (body.title !== undefined) update.title = body.title.trim()
    if (body.body !== undefined) update.body = body.body.trim()
    if (body.type !== undefined) update.type = body.type
    if (body.status !== undefined) update.status = body.status
    if ('image_url' in body) update.image_url = body.image_url
    if ('video_url' in body) update.video_url = body.video_url
    if ('media_urls' in body) update.media_urls = body.media_urls ?? []
    if ('focus_linkup_categories' in body) update.focus_linkup_categories = body.focus_linkup_categories ?? []
    if ('is_pinned' in body) update.is_pinned = !!body.is_pinned

    // Enforce max-5 pinned per course
    if (update.is_pinned === true) {
      const { data: ann } = await admin
        .from('announcements')
        .select('course_id, is_pinned')
        .eq('id', id)
        .single()
      if (ann && !ann.is_pinned && ann.course_id) {
        const { count } = await admin
          .from('announcements')
          .select('id', { count: 'exact', head: true })
          .eq('course_id', ann.course_id)
          .eq('is_pinned', true)
        if ((count ?? 0) >= 5) {
          return NextResponse.json(
            { error: 'Maximum of 5 announcements can be pinned at a time.' },
            { status: 400 }
          )
        }
      }
    }

    const { data, error } = await admin
      .from('announcements')
      .update(update)
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // data includes course_id — bust only that course's announcement cache.
    if (data.course_id) {
      await getCache(COURSE_ANN_NS).clear(courseAnnPrefix(data.course_id)).catch(() => {})
    }

    // Send push if this is a fresh publish (moderation approval), not an edit of existing post.
    if (isApproving && !wasAlreadyPublished && data.course_id) {
      const notifPayload = NotificationTemplates.announcementBroadcast(data.title, data.body, data.type, data.id)
      const categories: string[] = data.focus_linkup_categories ?? []
      ;(categories.length
        ? sendPushToFocusMembers(data.course_id, categories, notifPayload, ctx.userId)
        : sendPushToCourse(data.course_id, notifPayload, ctx.userId)
      ).catch(() => {})
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

    // Fetch course_id before deleting so we can invalidate the right cache.
    const { data: existing } = await admin
      .from('announcements')
      .select('course_id')
      .eq('id', id)
      .single()

    const { error } = await admin.from('announcements').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (existing?.course_id) {
      await getCache(COURSE_ANN_NS).clear(courseAnnPrefix(existing.course_id)).catch(() => {})
    }

    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
