export const dynamic = 'force-dynamic'

// POST /api/admin/members/bulk-tags
// Adds or removes a single GHL tag across many members at once.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { addTagToContact, removeTagFromContact } from '@/lib/ghl/client'
import type { AuthContext } from '@/lib/auth/types'

export const POST = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const body = await req.json() as { memberIds?: string[]; tag?: string; action?: 'add' | 'remove' }
    const memberIds = body.memberIds ?? []
    const tag = body.tag?.trim()

    if (!memberIds.length) return NextResponse.json({ error: 'memberIds is required' }, { status: 400 })
    if (!tag) return NextResponse.json({ error: 'tag is required' }, { status: 400 })
    if (body.action !== 'add' && body.action !== 'remove') {
      return NextResponse.json({ error: 'action must be "add" or "remove"' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: members, error } = await admin
      .from('members')
      .select('id, first_name, last_name, ghl_contact_id, ghl_tags')
      .in('id', memberIds)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    let succeeded = 0
    const failed: string[] = []

    for (const member of members ?? []) {
      const label = `${member.first_name} ${member.last_name}`
      const ok = body.action === 'add'
        ? await addTagToContact(member.ghl_contact_id, tag)
        : await removeTagFromContact(member.ghl_contact_id, tag)

      if (!ok) { failed.push(label); continue }

      const currentTags: string[] = member.ghl_tags ?? []
      const nextTags = body.action === 'add'
        ? currentTags.includes(tag) ? currentTags : [...currentTags, tag]
        : currentTags.filter(t => t !== tag)

      await admin.from('members').update({ ghl_tags: nextTags }).eq('id', member.id)
      succeeded++
    }

    return NextResponse.json({ total: members?.length ?? 0, succeeded, failed })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
