export const dynamic = 'force-dynamic'

// GET  /api/admin/referral-partners/[id]/links  — list this partner's links
// POST /api/admin/referral-partners/[id]/links  — bulk-link members + non-member
//        emails: writes the partner code + percentage to each GHL contact
//        (creating a contact for a non-member email), then upserts link rows.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { linkTargetsToPartner, type LinkTarget } from '@/lib/referral-links'
import type { AuthContext } from '@/lib/auth/types'

const MAX_PER_BATCH = 100

export const GET = withAuth(
  async (_req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing partner id' }, { status: 400 })

    const admin = createAdminClient()
    const { data, error } = await admin
      .from('referral_partner_links')
      .select('*, member:members(first_name, last_name, email, membership_status)')
      .eq('referral_partner_id', id)
      .order('created_at', { ascending: false })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ links: data ?? [] })
  },
  { requireAdmin: true, skipGHLCheck: true }
)

export const POST = withAuth(
  async (req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing partner id' }, { status: 400 })

    const body = await req.json() as { memberIds?: string[]; emails?: string[] }
    const memberIds = [...new Set(body.memberIds ?? [])]
    const rawEmails = [...new Set((body.emails ?? []).map(e => e.trim().toLowerCase()).filter(Boolean))]

    if (!memberIds.length && !rawEmails.length) {
      return NextResponse.json({ error: 'Select at least one member or enter an email' }, { status: 400 })
    }
    if (memberIds.length + rawEmails.length > MAX_PER_BATCH) {
      return NextResponse.json({ error: `Please link ${MAX_PER_BATCH} contacts or fewer per batch` }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: partner } = await admin
      .from('referral_partners').select('id').eq('id', id).single()
    if (!partner) return NextResponse.json({ error: 'Referral partner not found' }, { status: 404 })

    // Selected members are addressed by email like everything else — that's
    // the key attribution is stored under.
    const { data: memberRows } = memberIds.length
      ? await admin.from('members').select('id, first_name, last_name, email').in('id', memberIds)
      : { data: [] as Array<{ id: string; first_name: string; last_name: string; email: string }> }

    const targets: LinkTarget[] = [
      ...(memberRows ?? []).map(m => ({
        email: m.email,
        name: `${m.first_name} ${m.last_name}`.trim() || null,
      })),
      ...rawEmails.map(email => ({ email })),
    ]

    // repoint: an admin picking contacts here is deliberately assigning them,
    // so a contact already attributed elsewhere moves to this partner.
    const outcomes = await linkTargetsToPartner(admin, id, targets, { repoint: true })

    // 'already' counts as success: the edit drawer re-submits a partner's
    // existing selection on every save, and that shouldn't read as a failure.
    const succeeded = outcomes.filter(o => o.status !== 'skipped').length
    const failed = outcomes.filter(o => o.status === 'skipped').map(o => o.email)

    return NextResponse.json({ total: targets.length, succeeded, failed })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
