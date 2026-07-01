export const dynamic = 'force-dynamic'

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { createGHLCalendar } from '@/lib/ghl/client'
import { AVIARA_TIMEZONE } from '@/lib/constants'
import type { AuthContext } from '@/lib/auth/types'
import type { Course } from '@/types'

const CALENDAR_COLORS = ['#16a34a', '#0ea5e9', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899']
function randomColor() { return CALENDAR_COLORS[Math.floor(Math.random() * CALENDAR_COLORS.length)] ?? '#16a34a' }
function toSlug(name: string) { return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

export const GET = withAuth(
  async (_req: NextRequest, _ctx: AuthContext) => {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('courses')
      .select('*, requester:members!requested_by(first_name, last_name)')
      .order('name')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ courses: data ?? [] })
  },
  { requireAdmin: true, skipGHLCheck: true }
)

export const POST = withAuth(
  async (req: NextRequest, ctx: AuthContext) => {
    const body = await req.json() as Partial<Course> & { createCalendar?: boolean }

    if (!body.name?.trim()) return NextResponse.json({ error: 'Course name required' }, { status: 400 })
    if (!body.logo_url?.trim()) return NextResponse.json({ error: 'A venue logo is required' }, { status: 400 })

    const slug = body.slug?.trim() || toSlug(body.name)
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return NextResponse.json({ error: 'Slug must be lowercase letters, numbers, and hyphens only' }, { status: 400 })
    }

    if (body.booking_url?.trim() && !isValidUrl(body.booking_url.trim())) {
      return NextResponse.json({ error: 'Booking URL must be a valid URL (e.g. https://example.com)' }, { status: 400 })
    }

    const admin = createAdminClient()

    // Slug uniqueness check
    const { data: existing } = await admin.from('courses').select('id').eq('slug', slug).limit(1)
    if (existing?.length) {
      return NextResponse.json({ error: `The slug "${slug}" is already taken. Choose a different one.` }, { status: 409 })
    }

    const ghlCalendarId: string | null = body.ghl_calendar_id ?? null

    // Calendar uniqueness: reject if the selected calendar is already assigned to another course
    if (ghlCalendarId) {
      const { data: calConflict } = await admin
        .from('courses')
        .select('id, name')
        .eq('ghl_calendar_id', ghlCalendarId)
        .limit(1)
      if (calConflict?.length) {
        return NextResponse.json(
          { error: `This GHL calendar is already assigned to "${calConflict[0]?.name ?? 'another course'}". Each course must use a unique calendar.` },
          { status: 409 }
        )
      }
    }

    const requiredTags = body.required_tags ?? []

    const { data, error } = await admin
      .from('courses')
      .insert({
        name: body.name.trim(),
        slug,
        logo_url: body.logo_url.trim(),
        city: body.city ?? '',
        state: body.state ?? '',
        country: body.country ?? 'US',
        access_tag: requiredTags[0] ?? '',
        timezone: body.timezone ?? AVIARA_TIMEZONE,
        active: true,
        ghl_calendar_id: ghlCalendarId,
        description: body.description?.trim() || null,
        cost_per_player: body.cost_per_player ?? null,
        booking_rules: body.booking_rules ?? null,
        booking_url: body.booking_url?.trim() || null,
        required_tags: requiredTags,
        approval_status: 'active',
        reviewed_by: ctx.userId,
      })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ course: data }, { status: 201 })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
