export const dynamic = 'force-dynamic'

// GET  /api/admin/referral-partners/[id]/links  — list this partner's links
// POST /api/admin/referral-partners/[id]/links  — bulk-link members + non-member
//        emails: writes the partner code + percentage to each GHL contact
//        (creating a contact for a non-member email), then upserts link rows.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateEmail } from '@/lib/validation'
import { findOrCreateContactByEmail } from '@/lib/ghl/client'
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

    // Load member rows for the selected members
    const { data: memberRows } = memberIds.length
      ? await admin.from('members').select('id, first_name, last_name, email, ghl_contact_id').in('id', memberIds)
      : { data: [] as Array<{ id: string; first_name: string; last_name: string; email: string; ghl_contact_id: string }> }

    // Emails that already belong to an existing member → link with member_id set
    const { data: emailMembers } = rawEmails.length
      ? await admin.from('members').select('id, email').in('email', rawEmails)
      : { data: [] as Array<{ id: string; email: string }> }
    const memberByEmail = new Map((emailMembers ?? []).map(m => [m.email.toLowerCase(), m.id]))

    let succeeded = 0
    const failed: string[] = []

    async function upsertLink(row: {
      email: string
      member_id: string | null
      ghl_contact_id: string | null
    }) {
      const { error } = await admin
        .from('referral_partner_links')
        .upsert(
          {
            referral_partner_id: id,
            email: row.email,
            member_id: row.member_id,
            ghl_contact_id: row.ghl_contact_id,
            status: 'linked',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'email' }
        )
      return !error
    }

    // Members: attribution lives entirely in our DB — just record the link
    // against the member's known GHL contact id. No GHL write.
    for (const m of memberRows ?? []) {
      const label = `${m.first_name} ${m.last_name}`.trim() || m.email
      const linked = await upsertLink({
        email: m.email.toLowerCase(),
        member_id: m.id,
        ghl_contact_id: m.ghl_contact_id,
      })
      if (linked) succeeded++; else failed.push(label)
    }

    // Non-member (or member-by-email) targets: land them in GHL as a lead
    // (best-effort — a GHL outage yields a null contact id but still links).
    for (const email of rawEmails) {
      if (!validateEmail(email).valid) { failed.push(email); continue }
      const memberId = memberByEmail.get(email) ?? null
      const contactId = memberId ? null : await findOrCreateContactByEmail({ email })
      const linked = await upsertLink({ email, member_id: memberId, ghl_contact_id: contactId })
      if (linked) succeeded++; else failed.push(email)
    }

    return NextResponse.json({ total: memberIds.length + rawEmails.length, succeeded, failed })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
