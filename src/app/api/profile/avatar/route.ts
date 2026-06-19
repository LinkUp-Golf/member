export const dynamic = 'force-dynamic'

import { type NextRequest, NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { getCache } from '@/lib/cache'
import { MEMBER_DETAIL_NS, memberDetailKey } from '@/lib/cache/keys'
import type { AuthContext } from '@/lib/auth/types'

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_BYTES = 5 * 1024 * 1024

export const POST = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const form = await req.formData()
  const file = form.get('file')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file field is required' }, { status: 400 })
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: 'Only JPEG, PNG, or WebP images are allowed' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Image must be 5 MB or smaller' }, { status: 400 })
  }

  const supabase = createRouteHandlerClient(cookies())
  const admin = createAdminClient()

  // Delete previous avatar to avoid orphaned blobs
  const { data: existing } = await supabase
    .from('member_profiles')
    .select('avatar_url')
    .eq('id', ctx.userId)
    .single()

  if (existing?.avatar_url) {
    try {
      const oldPath = new URL(existing.avatar_url).pathname
        .replace(/^\/storage\/v1\/object\/public\/avatars\//, '')
      if (oldPath.startsWith(ctx.userId)) {
        await admin.storage.from('avatars').remove([oldPath])
      }
    } catch {
      // Non-fatal: best-effort cleanup
    }
  }

  // Upload new avatar
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const objectPath = `${ctx.userId}/${Date.now()}.${ext}`
  const bytes = await file.arrayBuffer()

  const { error: uploadError } = await admin.storage
    .from('avatars')
    .upload(objectPath, bytes, { contentType: file.type, upsert: true })

  if (uploadError) {
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }

  const { data: { publicUrl } } = admin.storage.from('avatars').getPublicUrl(objectPath)

  // Persist URL to member_profiles
  const { error: dbError } = await supabase
    .from('member_profiles')
    .update({ avatar_url: publicUrl, updated_at: new Date().toISOString() })
    .eq('id', ctx.userId)

  if (dbError) {
    return NextResponse.json({ error: 'Failed to save avatar URL' }, { status: 500 })
  }

  // Invalidate member detail cache
  await getCache(MEMBER_DETAIL_NS).delete(memberDetailKey(ctx.userId)).catch(() => {})

  return NextResponse.json({ avatarUrl: publicUrl })
})
