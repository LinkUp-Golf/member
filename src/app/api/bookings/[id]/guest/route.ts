export const dynamic = 'force-dynamic'

// PATCH /api/bookings/[id]/guest
// Lets the booker (not the guest — they have no login) fix a non-member
// guest's contact details while that guest's booking row is still
// 'awaiting_approval' (not yet set up in GHL by an admin). Once an admin
// has acted on it, editing here is no longer allowed — GHL is already
// involved and the row is no longer "pending".

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { cookies } from 'next/headers'
import { withAuth } from '@/lib/auth/with-auth'
import { createRouteHandlerClient, createAdminClient } from '@/lib/supabase-server'
import { validateEmail, validateString, sanitiseText } from '@/lib/validation'
import type { AuthContext } from '@/lib/auth/types'
import type { AdditionalPlayer } from '@/types'

export const PATCH = withAuth(async (
  req: NextRequest,
  ctx: AuthContext,
  routeCtx?: { params: Record<string, string> }
) => {
  const id = routeCtx?.params?.['id']
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const body = await req.json().catch(() => ({})) as Partial<AdditionalPlayer>
  const firstName = body.firstName?.trim() ?? ''
  const lastName = body.lastName?.trim() ?? ''
  const email = body.email?.trim() ?? ''
  const mobile = body.mobile?.trim() ?? ''

  if (!validateEmail(email).valid) {
    return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  }
  if (mobile.length < 7) {
    return NextResponse.json({ error: 'A valid phone number is required' }, { status: 400 })
  }
  for (const name of [firstName, lastName]) {
    if (name && !validateString(name, 'name', { max: 100 }).valid) {
      return NextResponse.json({ error: 'Names must be 100 characters or fewer' }, { status: 400 })
    }
  }

  // Only the booker can edit — non-member guests have no login of their own.
  const supabase = createRouteHandlerClient(cookies())
  const { data: booking } = await supabase
    .from('bookings')
    .select('id, status')
    .eq('id', id)
    .eq('member_id', ctx.userId)
    .single()

  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
  if (booking.status !== 'awaiting_approval') {
    return NextResponse.json({ error: 'This guest has already been processed and can no longer be edited.' }, { status: 409 })
  }

  const cleanFirst = firstName ? sanitiseText(firstName) : firstName
  const cleanLast = lastName ? sanitiseText(lastName) : lastName
  const updatedPlayer: AdditionalPlayer = {
    firstName: cleanFirst,
    lastName: cleanLast,
    email,
    mobile,
    isNonMember: true,
  }
  const guestName = [cleanFirst, cleanLast].filter(Boolean).join(' ').trim() || email

  const admin = createAdminClient()
  const { error } = await admin
    .from('bookings')
    .update({ guest_name: guestName, additional_players: [updatedPlayer] })
    .eq('id', id)
    .eq('status', 'awaiting_approval')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, guest_name: guestName, additional_players: [updatedPlayer] })
})
