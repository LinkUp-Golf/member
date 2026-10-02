export const dynamic = 'force-dynamic'

// POST /api/host/events/[id]/attendance — who turned up.
//
// The body is the whole set of members present, not a change to it: the host is
// looking at a list of ticks and the screen's state is the answer, so sending it
// whole is both what the UI has and what makes a retry harmless. Marked rows are
// inserted, unmarked ones deleted, and a round nobody attended ends with no rows
// rather than a table of falses — absence is the absence of a row.
//
// Only members on the round can be ticked. The roster is computed here rather
// than trusted from the request: a host sends ids their own screen showed them,
// but the screen is not the authority on who was at the round, and an id from
// somewhere else would otherwise write a record about a member who was never
// there. Strangers are dropped rather than refused — the host's ticks still save,
// and nothing about the roster is revealed by what did or didn't stick.
//
// Same window as the proof photo (canMarkAttendance): you can only say who came
// once the round has happened, and a host can keep correcting it right up until
// the credit is decided.

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withHostAuth, type HostAuthContext } from '@/lib/auth/with-host-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { canMarkAttendance, enrichHostedEvents } from '@/lib/hosts/events'
import { validateUUID } from '@/lib/validation'
import { logger } from '@/lib/logger'
import type { HostedEvent } from '@/types'

export const POST = withHostAuth(
  async (req: NextRequest, ctx: HostAuthContext, routeCtx?: { params: Record<string, string> }) => {
    const id = routeCtx?.params?.['id']
    if (!id) return NextResponse.json({ error: 'Missing event id' }, { status: 400 })

    const body = await req.json().catch(() => ({})) as { member_ids?: unknown }
    if (!Array.isArray(body.member_ids)) {
      return NextResponse.json({ error: 'member_ids must be a list' }, { status: 400 })
    }

    // Deduplicated, and only things shaped like an id — an unparseable value in
    // an `in` filter below would fail the whole save rather than one tick.
    const asked = Array.from(
      new Set(
        body.member_ids.filter(
          (v): v is string => typeof v === 'string' && validateUUID(v, 'Member').valid,
        ),
      ),
    )

    const admin = createAdminClient()

    const { data: event } = await admin
      .from('hosted_events')
      .select('*')
      .eq('id', id)
      .eq('host_id', ctx.host.id)
      .maybeSingle()

    if (!event) return NextResponse.json({ error: 'Event not found' }, { status: 404 })
    if (!canMarkAttendance(event.status, event.event_date)) {
      return NextResponse.json(
        { error: 'You can mark attendance once the round has taken place.' },
        { status: 409 },
      )
    }

    // Everyone the round had on it — reservations plus members who booked the
    // venue that day. The same roster the host's list draws its faces from, so a
    // tick they could see is a tick that saves.
    const [enriched] = await enrichHostedEvents(admin, [event as HostedEvent], {
      withPlayers: true,
    })
    const roster = new Set((enriched?.players ?? []).map(p => p.member_id))
    const present = asked.filter(memberId => roster.has(memberId))

    // Replace the set: everyone ticked is in, everyone else is out. Delete first
    // so a member unticked in the same call can't survive the upsert, and scoped
    // to this event so no other round is touched.
    const removal = present.length > 0
      ? admin
          .from('hosted_event_attendance')
          .delete()
          .eq('hosted_event_id', id)
          .not('member_id', 'in', `(${present.join(',')})`)
      : admin.from('hosted_event_attendance').delete().eq('hosted_event_id', id)

    const { error: deleteError } = await removal
    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    if (present.length > 0) {
      const { error: upsertError } = await admin
        .from('hosted_event_attendance')
        .upsert(
          present.map(memberId => ({
            hosted_event_id: id,
            member_id: memberId,
            marked_by: ctx.userId,
          })),
          { onConflict: 'hosted_event_id,member_id', ignoreDuplicates: true },
        )
      if (upsertError) {
        return NextResponse.json({ error: upsertError.message }, { status: 500 })
      }
    }

    logger.info('Hosted event attendance saved', {
      action: 'host.event.attendance_saved',
      userId: ctx.userId,
      metadata: {
        event_id: id,
        host_id: ctx.host.id,
        marked: present.length,
        // Ids the host sent that aren't on the round. Non-zero means their screen
        // and this roster disagree, which is worth seeing rather than silently
        // dropping.
        off_roster: asked.length - present.length,
      },
    })

    return NextResponse.json({ ok: true, member_ids: present })
  },
)
