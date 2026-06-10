export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { getCache } from '@/lib/cache'
import { COURSE_PROMO_NS, coursePromoPrefix } from '@/lib/cache/keys'
import { sendPushToCourse, sendPushToMembers, NotificationTemplates } from '@/lib/push'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const body = await req.json() as {
      course_id: string | null
      title: string
      description: string
      partner_name: string
      badge_label: string
      cta_label?: string
      cta_url?: string | null
      expires_at?: string | null
      sort_order?: number
      image_url?: string | null
      video_url?: string | null
      media_urls?: string[]
    }

    if (!body.title?.trim() || !body.description?.trim() || !body.partner_name?.trim() || !body.badge_label?.trim()) {
      return NextResponse.json(
        { error: 'title, description, partner_name and badge_label are required' },
        { status: 400 }
      )
    }

    const admin = createAdminClient()
    const { data, error } = await admin.from('promotions').insert({
      course_id: body.course_id ?? null,
      title: body.title.trim(),
      description: body.description.trim(),
      partner_name: body.partner_name.trim(),
      badge_label: body.badge_label.trim(),
      cta_label: body.cta_label?.trim() ?? 'Learn more',
      cta_url: body.cta_url?.trim() || null,
      expires_at: body.expires_at || null,
      active: true,
      sort_order: body.sort_order ?? 0,
      image_url: body.image_url ?? null,
      video_url: body.video_url ?? null,
      media_urls: body.media_urls ?? [],
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Promotions can be course-specific (course_id set) or global (null).
    // Bust the specific course cache when scoped, or all course caches when global.
    const payload = NotificationTemplates.promotionAvailable(data.partner_name, data.title, data.id)
    if (data.course_id) {
      await getCache(COURSE_PROMO_NS).clear(coursePromoPrefix(data.course_id)).catch(() => {})
      sendPushToCourse(data.course_id, payload).catch(() => {})
    } else {
      // Global promotion — affects every course's list. Clear the entire namespace.
      await getCache(COURSE_PROMO_NS).clear('course:promo:').catch(() => {})
      // Notify all active members across all courses.
      ;(async () => {
        const admin = createAdminClient()
        const { data: members } = await admin
          .from('members')
          .select('id')
          .eq('membership_status', 'active')
        if (members?.length) {
          await sendPushToMembers(members.map(m => m.id), payload)
        }
      })().catch(() => {})
    }

    return NextResponse.json(data, { status: 201 })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
