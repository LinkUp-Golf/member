// ============================================================
// The guest gate for routes that authenticate themselves.
//
// withAuth refuses a guest (isGuestOnly) every route not marked allowGuests.
// A few routes predate withAuth and check the session on their own — booking
// creation among them — so they ask here instead. Same rule, same answer.
//
// Server-only.
// ============================================================

import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isGuestOnly } from '@/lib/ghl/tags'
import { ErrorCode } from '@/lib/errors/app-error'

/**
 * A 403 when the signed-in member is a guest, null when they may go on.
 *
 * Reads their own member row, so the session's own client is enough under RLS.
 * A row that can't be read is refused: this stands between a guest and a
 * booking, and it fails closed.
 */
export async function refuseGuest(supabase: SupabaseClient, userId: string): Promise<NextResponse | null> {
  const { data } = await supabase
    .from('members')
    .select('is_admin, ghl_tags')
    .eq('id', userId)
    .single()

  if (data?.is_admin) return null
  if (data && !isGuestOnly(data.ghl_tags ?? [])) return null

  return NextResponse.json(
    { error: 'Booking is for members. Become a member to book a round.', code: ErrorCode.MEMBERSHIP_REQUIRED },
    { status: 403 },
  )
}
