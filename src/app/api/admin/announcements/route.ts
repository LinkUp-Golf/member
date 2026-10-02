export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { getCache } from '@/lib/cache'
import { COURSE_ANN_NS, courseAnnPrefix } from '@/lib/cache/keys'
import { NotificationTemplates } from '@/lib/push'
import { notifyCourse, notifyFocusMembers, kept } from '@/lib/notify'
import { normaliseAudience, resolveEmailAudience } from '@/lib/announcements/recipients'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext) => {
    const body = await req.json() as {
      course_id: string
      type?: string
      title: string
      body: string
      image_url?: string | null
      video_url?: string | null
      media_urls?: string[]
      focus_linkup_categories?: string[]
      // Who gets it by email, by tag or by name. Both empty means no email is
      // sent at all — there is no "everyone", deliberately. The post and the
      // in-app notification reach the community either way.
      email_tags?: string[]
      email_member_ids?: string[]
    }

    if (!body.title?.trim() || !body.body?.trim() || !body.course_id) {
      return NextResponse.json({ error: 'course_id, title and body are required' }, { status: 400 })
    }

    const audience = normaliseAudience({
      tags: body.email_tags,
      memberIds: body.email_member_ids,
    })

    const admin = createAdminClient()
    const { data, error } = await admin.from('announcements').insert({
      email_tags: audience.tags,
      email_member_ids: audience.memberIds,
      course_id: body.course_id,
      author_id: ctx.userId,
      type: body.type ?? 'admin_broadcast',
      title: body.title.trim(),
      body: body.body.trim(),
      status: 'published',
      published_at: new Date().toISOString(),
      image_url: body.image_url ?? null,
      video_url: body.video_url ?? null,
      media_urls: body.media_urls ?? [],
      focus_linkup_categories: body.focus_linkup_categories ?? [],
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Invalidate all cached variants for this course's announcements.
    await getCache(COURSE_ANN_NS).clear(courseAnnPrefix(body.course_id)).catch(() => {})

    // Notify course members (fire-and-forget; excludes the author).
    // When focus_linkup_categories are set, only notify subscribed members.
    const notifPayload = NotificationTemplates.announcementBroadcast(data.title, data.body, data.type, data.id)
    const categories: string[] = body.focus_linkup_categories ?? []
    // The post and the in-app notification go to the community either way; only
    // the email narrows. null here means "the same people the push reaches".
    const emailMemberIds = await resolveEmailAudience(admin, body.course_id, audience, ctx.userId)
    void kept((categories.length
      ? notifyFocusMembers(body.course_id, categories, notifPayload, ctx.userId, { emailMemberIds })
      : notifyCourse(body.course_id, notifPayload, ctx.userId, { emailMemberIds })
    ).catch(() => {}))

    return NextResponse.json(data, { status: 201 })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
