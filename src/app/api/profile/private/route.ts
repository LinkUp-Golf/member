export const dynamic = 'force-dynamic'

// GET / PATCH /api/profile/private — the signed-in member's own gender and
// date of birth. Private: used only for Curated Introductions matching, never
// shown to another member. Stored in member_match_profiles through the service
// role (src/lib/members/private-fields.ts) and synced to GoHighLevel — gender
// as one of the tags gender-male / gender-female / gender-pns, date of birth in
// the standard Date of Birth field (left blank for "Prefer not to say").
//
// GoHighLevel is written first; if it can't be, nothing is saved (see
// src/lib/sync/profile.push.ts for why).

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { isStoredGender, parseDateOfBirth } from '@/lib/ghl/profile-fields'
import { loadPrivateFields, savePrivateFields, type PrivateFields } from '@/lib/members/private-fields'
import { GhlProfileSyncError, pushGenderToGhl, pushProfileToGhl } from '@/lib/sync/profile.push'
import type { AuthContext } from '@/lib/auth/types'

export const GET = withAuth(async (_req: NextRequest, ctx: AuthContext) => {
  const fields = await loadPrivateFields(createAdminClient(), ctx.userId)
  return NextResponse.json(fields)
}, { allowGuests: true })

export const PATCH = withAuth(async (req: NextRequest, ctx: AuthContext) => {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const admin = createAdminClient()
  const current = await loadPrivateFields(admin, ctx.userId)
  const next: Partial<PrivateFields> = {}

  if ('gender' in body) {
    if (body.gender !== null && !isStoredGender(body.gender)) {
      return NextResponse.json({ error: 'Choose Male, Female or Prefer not to say.' }, { status: 400 })
    }
    if (body.gender !== current.gender) next.gender = body.gender as PrivateFields['gender']
  }

  if ('dob_prefer_not' in body || 'date_of_birth' in body) {
    const preferNot = body.dob_prefer_not === true
    let dob: string | null = null
    if (!preferNot && body.date_of_birth) {
      dob = parseDateOfBirth(body.date_of_birth, new Date())
      if (!dob) return NextResponse.json({ error: 'Enter your date of birth as a real date.' }, { status: 400 })
    }
    if (dob !== current.date_of_birth) next.date_of_birth = dob
    if (preferNot !== current.dob_prefer_not) next.dob_prefer_not = preferNot
  }

  if (Object.keys(next).length === 0) return NextResponse.json(current)

  const { data: member } = await admin.from('members').select('ghl_contact_id').eq('id', ctx.userId).single()
  const contactId = member?.ghl_contact_id as string | null | undefined
  if (contactId) {
    try {
      if ('gender' in next) await pushGenderToGhl(contactId, next.gender ?? null)
      if ('date_of_birth' in next) await pushProfileToGhl(contactId, { date_of_birth: next.date_of_birth ?? null })
    } catch (err) {
      if (err instanceof GhlProfileSyncError) {
        return NextResponse.json(
          { error: "Your changes couldn't be saved just now. Nothing was changed — please try again in a minute." },
          { status: 502 },
        )
      }
      throw err
    }
  }

  await savePrivateFields(admin, ctx.userId, next)
  return NextResponse.json({ ...current, ...next })
}, { allowGuests: true })
