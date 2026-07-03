export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { listCalendars } from '@/lib/ghl/client'

export const GET = withAuth(
  async (req: NextRequest) => {
    const params = new URL(req.url).searchParams
    const groupId = params.get('groupId')
    // When editing a course, pass its id so we don't exclude its own calendar
    const excludeCourseId = params.get('excludeCourseId')

    // Fetch GHL calendars (class_booking only, optionally scoped to a group)
    const all = await listCalendars()
    const classBooking = all
      .filter(c => c.calendarType === 'class_booking')
      .filter(c => !groupId || c.groupId === groupId)

    // Fetch calendar IDs already assigned to other courses
    const admin = createAdminClient()
    let query = admin.from('courses').select('ghl_calendar_id').not('ghl_calendar_id', 'is', null)
    if (excludeCourseId) query = query.neq('id', excludeCourseId)
    const { data: usedRows } = await query
    const usedIds = new Set((usedRows ?? []).map(r => r.ghl_calendar_id as string).filter(Boolean))

    // Only return calendars not already assigned to another course
    const available = classBooking.filter(c => !usedIds.has(c.id))

    return NextResponse.json({ calendars: available })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
