export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
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
    }

    if (!body.title?.trim() || !body.body?.trim() || !body.course_id) {
      return NextResponse.json({ error: 'course_id, title and body are required' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin.from('announcements').insert({
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
    }).select().single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data, { status: 201 })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
