export const dynamic = 'force-dynamic'

// GET  /api/partner/submissions — the caller's own submitted referral lists.
// POST /api/partner/submissions — submit a list of referrals for an admin to
//        import. Creates the batch only; attribution happens on import.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withPartnerAuth, type PartnerAuthContext } from '@/lib/auth/with-partner-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { validateEmail, sanitiseText } from '@/lib/validation'
import { logger } from '@/lib/logger'

const MAX_ENTRIES = 200

interface SubmittedEntry {
  email?: string
  name?: string
}

export const GET = withPartnerAuth(async (_req: NextRequest, ctx: PartnerAuthContext) => {
  const admin = createAdminClient()

  const { data, error } = await admin
    .from('referral_partner_submissions')
    .select('*, entries:referral_partner_submission_entries(*)')
    .eq('referral_partner_id', ctx.partner.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ submissions: data ?? [] })
})

export const POST = withPartnerAuth(async (req: NextRequest, ctx: PartnerAuthContext) => {
  const body = await req.json().catch(() => ({})) as {
    entries?: SubmittedEntry[]
    note?: string
  }

  const rawEntries = Array.isArray(body.entries) ? body.entries : []
  if (!rawEntries.length) {
    return NextResponse.json({ error: 'Add at least one referral to submit.' }, { status: 400 })
  }
  if (rawEntries.length > MAX_ENTRIES) {
    return NextResponse.json(
      { error: `Please submit ${MAX_ENTRIES} referrals or fewer at a time.` },
      { status: 400 }
    )
  }

  // Normalise and dedupe before validating, so a list pasted with duplicates
  // isn't rejected outright — the extras just collapse.
  const byEmail = new Map<string, { email: string; name: string | null }>()
  const invalid: string[] = []

  for (const entry of rawEntries) {
    const email = (entry.email ?? '').trim().toLowerCase()
    if (!email) continue
    if (!validateEmail(email).valid) { invalid.push(email); continue }
    if (byEmail.has(email)) continue
    const name = (entry.name ?? '').trim()
    byEmail.set(email, { email, name: name ? sanitiseText(name).slice(0, 120) : null })
  }

  if (invalid.length) {
    return NextResponse.json(
      { error: `These aren't valid email addresses: ${invalid.slice(0, 5).join(', ')}` },
      { status: 400 }
    )
  }
  if (!byEmail.size) {
    return NextResponse.json({ error: 'Add at least one referral to submit.' }, { status: 400 })
  }

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

  const entries = [...byEmail.values()]

  const { data: submission, error } = await admin
    .from('referral_partner_submissions')
    .insert({
      referral_partner_id: ctx.partner.id,
      note: body.note?.trim() ? sanitiseText(body.note.trim()).slice(0, 500) : null,
      entry_count: entries.length,
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

  return NextResponse.json({ submission: { ...submission, entries } }, { status: 201 })
})
