export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
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
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data, { status: 201 })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
