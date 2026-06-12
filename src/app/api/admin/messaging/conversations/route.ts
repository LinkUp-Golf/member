export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import type { AuthContext } from '@/lib/auth/types'

// GET /api/admin/messaging/conversations
// Query params: type (direct|group|all), search (member name/email), limit, offset
export const GET = withAuth(
  async (req: NextRequest, _ctx: AuthContext) => {
    const { searchParams } = new URL(req.url)
    const type   = searchParams.get('type') ?? 'all'
    const search = searchParams.get('search')?.trim() ?? ''
    const limit  = Math.min(Number(searchParams.get('limit') ?? 30), 100)
    const offset = Number(searchParams.get('offset') ?? 0)

    const admin = createAdminClient()

    // If searching by member name/email, resolve matching member IDs first
    let memberIdFilter: string[] | null = null
    if (search) {
      const { data: matched } = await admin
        .from('members')
        .select('id')
        .or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%`)
        .limit(50)
      memberIdFilter = (matched ?? []).map(m => m.id)
      // If the search term matches nobody, return empty immediately
      if (memberIdFilter.length === 0) {
        return NextResponse.json({ conversations: [], total: 0 })
      }
    }

    // Build conversation query
    let convQuery = admin
      .from('conversations')
      .select(`
        id, type, name, created_by, created_at, updated_at,
        participants:conversation_participants(
          status,
          member:members(
            id, first_name, last_name, email,
            profile:member_profiles(avatar_url)
          )
        )
      `, { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (type !== 'all') {
      convQuery = convQuery.eq('type', type)
    }

    // Filter to conversations where at least one member matches the search
    if (memberIdFilter) {
      // Get conversation IDs that contain one of the matching members
      const { data: matching } = await admin
        .from('conversation_participants')
        .select('conversation_id')
        .in('member_id', memberIdFilter)
      const convIds = [...new Set((matching ?? []).map(r => r.conversation_id))]
      if (convIds.length === 0) return NextResponse.json({ conversations: [], total: 0 })
      convQuery = convQuery.in('id', convIds)
    }

    const { data: convs, error, count } = await convQuery

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Batch-fetch message counts and last messages per conversation
    const convIds = (convs ?? []).map(c => c.id)
    const [countRes, lastMsgRes] = await Promise.all([
      admin
        .from('messages')
        .select('conversation_id, id')
        .in('conversation_id', convIds)
        .is('deleted_at', null),
      admin.rpc('get_last_messages_for_conversations', { conv_ids: convIds }),
    ])

    const msgCountMap: Record<string, number> = {}
    for (const row of (countRes.data ?? [])) {
      msgCountMap[row.conversation_id] = (msgCountMap[row.conversation_id] ?? 0) + 1
    }

    const lastMsgMap: Record<string, { body: string; sender_first: string; sender_last: string; created_at: string }> = {}
    for (const row of (lastMsgRes.data ?? [])) {
      lastMsgMap[row.conversation_id] = row
    }

    type MemberShape = {
      id: string; first_name: string; last_name: string; email: string
      profile: { avatar_url: string | null }[] | { avatar_url: string | null } | null
    }
    type RawParticipant = { status: string; member: MemberShape | null }
    type ActiveParticipant = { status: string; member: MemberShape }

    const conversations = (convs ?? []).map(c => {
      const raw = (c.participants ?? []) as unknown as RawParticipant[]
      const participants = raw
        .filter((p): p is ActiveParticipant => p.member !== null)
        .map(p => ({
          id: p.member.id,
          first_name: p.member.first_name,
          last_name: p.member.last_name,
          email: p.member.email,
          avatar_url: (Array.isArray(p.member.profile)
            ? p.member.profile[0]?.avatar_url
            : p.member.profile?.avatar_url) ?? null,
          status: p.status,
        }))

      const last = lastMsgMap[c.id]
      return {
        id: c.id,
        type: c.type,
        name: c.name,
        created_at: c.created_at,
        updated_at: c.updated_at,
        message_count: msgCountMap[c.id] ?? 0,
        participants,
        last_message: last
          ? {
              body: last.body,
              sender_name: `${last.sender_first} ${last.sender_last}`,
              created_at: last.created_at,
            }
          : null,
      }
    })

    return NextResponse.json({ conversations, total: count ?? 0 })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
