export const dynamic = 'force-dynamic'

// GET  /api/partner/submissions — the caller's own submitted referral lists.
// POST /api/partner/submissions — submit a list of referrals for an admin to
//        import. Creates the batch only; attribution happens on import.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withPartnerAuth, type PartnerAuthContext } from '@/lib/auth/with-partner-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { sanitiseText } from '@/lib/validation'
import { parseReferralCsv } from '@/lib/csv'
import { logger } from '@/lib/logger'

const MAX_ENTRIES = 200
// Generous for a 200-row [name][email] export, small enough that a wrong file
// (a spreadsheet, an image) is rejected before we try to parse it as text.
const MAX_CSV_BYTES = 512 * 1024

export const GET = withPartnerAuth(async (_req: NextRequest, ctx: PartnerAuthContext) => {
  const admin = createAdminClient()

  // csv_content is deliberately excluded — it's the whole uploaded file, and
  // shipping it with every row of a list view would bloat the response.
  const { data, error } = await admin
    .from('referral_partner_submissions')
    .select(`
      id, referral_partner_id, status, note, entry_count, imported_count,
      csv_filename, applied_percentage, rejection_reason, reviewed_at,
      created_at, updated_at,
      entries:referral_partner_submission_entries(*)
    `)
    .eq('referral_partner_id', ctx.partner.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ submissions: data ?? [] })
})

export const POST = withPartnerAuth(async (req: NextRequest, ctx: PartnerAuthContext) => {
  const body = await req.json().catch(() => ({})) as {
    csv?: string
    filename?: string
    note?: string
  }

  const csv = typeof body.csv === 'string' ? body.csv : ''
  if (!csv.trim()) {
    return NextResponse.json({ error: 'Attach a CSV file to submit.' }, { status: 400 })
  }
  if (Buffer.byteLength(csv, 'utf8') > MAX_CSV_BYTES) {
    return NextResponse.json({ error: 'That file is too large.' }, { status: 400 })
  }

  // Re-validated here even though the browser already checked: client-side
  // validation is a convenience, not a guarantee.
  const parsed = parseReferralCsv(csv)
  if (!parsed.valid) {
    return NextResponse.json(
      {
        error: parsed.errors[0] ?? 'That CSV could not be read.',
        // The full list so the client can show every row that needs fixing,
        // not just the first.
        errors: parsed.errors,
      },
      { status: 400 }
    )
  }
  if (parsed.rows.length > MAX_ENTRIES) {
    return NextResponse.json(
      { error: `Please submit ${MAX_ENTRIES} referrals or fewer at a time.` },
      { status: 400 }
    )
  }

  const entries = parsed.rows.map(r => ({
    email: r.email,
    name: r.name ? sanitiseText(r.name).slice(0, 120) : null,
  }))

  const admin = createAdminClient()

  // One open submission per partner — the partial unique index is the
  // race-safe backstop for this check.
  const { data: pending } = await admin
    .from('referral_partner_submissions')
    .select('id')
    .eq('referral_partner_id', ctx.partner.id)
    .eq('status', 'pending')
    .maybeSingle()
  if (pending) {
    return NextResponse.json(
      { error: 'You already have a list awaiting review. Add to it once it has been imported.' },
      { status: 409 }
    )
  }

  const { data: submission, error } = await admin
    .from('referral_partner_submissions')
    .insert({
      referral_partner_id: ctx.partner.id,
      note: body.note?.trim() ? sanitiseText(body.note.trim()).slice(0, 500) : null,
      entry_count: entries.length,
      // Stored verbatim so the admin downloads what was actually uploaded,
      // not a re-rendering of our parse of it.
      csv_content: csv,
      csv_filename: body.filename?.trim().slice(0, 200) || 'referrals.csv',
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'You already have a list awaiting review.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const { error: entriesError } = await admin
    .from('referral_partner_submission_entries')
    .insert(entries.map(e => ({ submission_id: submission.id, email: e.email, name: e.name })))

  if (entriesError) {
    // An empty submission is worse than none — it would sit in the admin queue
    // with nothing to import.
    await admin.from('referral_partner_submissions').delete().eq('id', submission.id)
    return NextResponse.json({ error: 'Could not save your referral list.' }, { status: 500 })
  }

  logger.info('Referral list submitted', {
    action: 'referral_partner.submission.created',
    userId: ctx.userId,
    metadata: { partner_id: ctx.partner.id, submission_id: submission.id, entries: entries.length },
  })

  // Every row validated, so what's stored is exactly what was uploaded.
  return NextResponse.json({ submission: { ...submission, entries } }, { status: 201 })
})
