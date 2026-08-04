export const dynamic = 'force-dynamic'

// GET  /api/admin/hosts/[id]/credits — a host's credit summary and full ledger.
// POST /api/admin/hosts/[id]/credits — record a manual credit adjustment
//        (signed amount; a correction outside the earn/redeem flow, or a
//        discretionary top-up such as tipping a host who ran a good event).
//
// Addressed by host id because that's what the admin is looking at, but the
// wallet itself belongs to the member behind that host row.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { loadCreditSummary, loadCreditEntries } from '@/lib/credits'
import { sanitiseText } from '@/lib/validation'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'

// The ledger amount column is numeric(10,2); keep adjustments well within it.
const MAX_ADJUSTMENT = 1_000_000

export const GET = withAuth(
  async (_req: NextRequest, _ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing host id' }, { status: 400 })

    const admin = createAdminClient()
    const { data: host } = await admin
      .from('hosts')
      .select('id, name, status, member_id, member:members!hosts_member_id_fkey(first_name, last_name, email)')
      .eq('id', id)
      .maybeSingle()
    if (!host) return NextResponse.json({ error: 'Host not found' }, { status: 404 })

    const [summary, entries] = await Promise.all([
      loadCreditSummary(admin, host.member_id),
      loadCreditEntries(admin, host.member_id),
    ])

    return NextResponse.json({ host, summary, entries })
  },
  { requireAdmin: true, skipGHLCheck: true }
)

export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing host id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as { amount?: number; note?: string }
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount === 0) {
      return NextResponse.json({ error: 'Enter a non-zero amount (use a negative value to deduct).' }, { status: 400 })
    }
    if (Math.abs(amount) > MAX_ADJUSTMENT) {
      return NextResponse.json({ error: 'That amount is too large.' }, { status: 400 })
    }
    const note = typeof body.note === 'string' && body.note.trim() ? sanitiseText(body.note.trim()) : null

    const admin = createAdminClient()

    const { data: host } = await admin.from('hosts').select('id, member_id').eq('id', id).maybeSingle()
    if (!host) return NextResponse.json({ error: 'Host not found' }, { status: 404 })

    // Lock-safe: the RPC re-checks the balance under an advisory lock, so a
    // deduction can't race a concurrent redeem/adjust below zero.
    const { data: entry, error } = await admin.rpc('adjust_member_credit', {
      p_member_id: host.member_id,
      p_amount: amount,
      p_note: note,
      p_created_by: ctx.userId,
    })

    if (error) {
      if (error.message?.startsWith('INSUFFICIENT_BALANCE')) {
        return NextResponse.json({ error: 'That would take the balance below zero.' }, { status: 409 })
      }
      if (error.message?.startsWith('INVALID_AMOUNT')) {
        return NextResponse.json({ error: 'Enter a non-zero amount.' }, { status: 400 })
      }
      logger.error('Credit adjust failed', { action: 'credit.adjusted', userId: ctx.userId, metadata: { host_id: id, error: error.message } })
      return NextResponse.json({ error: 'Could not record the adjustment.' }, { status: 500 })
    }

    logger.info('Credit adjusted', {
      action: 'credit.adjusted',
      userId: ctx.userId,
      metadata: { host_id: id, member_id: host.member_id, amount },
    })

    const summary = await loadCreditSummary(admin, host.member_id)
    return NextResponse.json({ ok: true, entry, summary })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
