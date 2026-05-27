export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

export const PATCH = withAuth(
  async (req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
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
    }

    const update: Record<string, unknown> = {}
    if (body.title !== undefined) update.title = body.title.trim()
    if (body.body !== undefined) update.body = body.body.trim()
    if (body.type !== undefined) update.type = body.type
    if (body.status !== undefined) update.status = body.status
    if ('image_url' in body) update.image_url = body.image_url
    if ('video_url' in body) update.video_url = body.video_url
    if ('media_urls' in body) update.media_urls = body.media_urls ?? []

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('announcements')
      .update(update)
      .eq('id', id)
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  },
  { requireAdmin: true, skipGHLCheck: true }
)

export const DELETE = withAuth(
  async (_req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const admin = createAdminClient()
    const { error } = await admin.from('announcements').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
