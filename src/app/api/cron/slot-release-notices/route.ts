export const dynamic = 'force-dynamic'

// ============================================================
// GET /api/cron/slot-release-notices
// Runs every 15 minutes (vercel.json: "*/15 * * * *").
//
// Tells a club, a set number of hours before each tee time we hold there, that
// fewer than a set number of players are signed up — so it may release the
// open places. Agreed with Aviara management (2026-11-28): 72 hours, fewer than
// four, to the golf shop, copied to Greg. Each venue's address, hours,
// threshold and wording are on its admin form (courses.slot_release_notice_*).
// When it's due, who counts and the wording: src/lib/venues/slot-release-notice.ts.
//
// One notice per tee time. The tee time is claimed in slot_release_notices
// (unique per venue, date and tee time) before the email is sent, and the
// claim is released again if the send fails, so a later run in the window
// retries it.
//
// Only production writes to the club. Every other deployment sends the notice
// to the copy addresses alone (noticeRecipients), with "[Test]" on the subject.
//
// Test locally:
//   curl -H "Authorization: Bearer <CRON_SECRET>" \
//        http://localhost:3000/api/cron/slot-release-notices
//   Add ?now=2027-01-20T20:08:00Z to run it as of another moment (not in production).
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { addDays, format, subDays } from 'date-fns'
import { createAdminClient } from '@/lib/supabase-server'
import { sendEmail } from '@/lib/email/client'
import { escapeHtml } from '@/lib/email/template'
import {
  DEFAULT_NOTICE_HOURS,
  DEFAULT_NOTICE_MIN_PLAYERS,
  fillNoticeBody,
  groupTeeTimes,
  isNoticeDue,
  isProductionApp,
  noticeHostId,
  noticeRecipients,
  noticeSubject,
  parseEmailList,
  type NoticeSeatRow,
} from '@/lib/venues/slot-release-notice'
import { nameOrEmail } from '@/lib/utils'
import { AVIARA_TIMEZONE } from '@/lib/constants'
import { logger } from '@/lib/logger'

interface Venue {
  id: string
  name: string
  timezone: string | null
  playing_host_member_id: string | null
  slot_release_notice_to: string | null
  slot_release_notice_cc: string | null
  slot_release_notice_hours: number | null
  slot_release_notice_min_players: number | null
  slot_release_notice_body: string | null
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  }

  const production = isProductionApp(process.env.NEXT_PUBLIC_APP_URL)

  // A test deployment may be run as of another moment, to see a notice without
  // waiting for one to fall due.
  const nowParam = request.nextUrl.searchParams.get('now')
  const now = !production && nowParam && !Number.isNaN(Date.parse(nowParam)) ? new Date(nowParam) : new Date()

  const admin = createAdminClient()
  const results = { venues: 0, checked: 0, sent: 0, skipped: 0, errors: 0, production }

  const { data: venues, error: venuesError } = await admin
    .from('courses')
    .select(
      'id, name, timezone, playing_host_member_id, slot_release_notice_to, slot_release_notice_cc, ' +
        'slot_release_notice_hours, slot_release_notice_min_players, slot_release_notice_body',
    )
    .eq('slot_release_notice_enabled', true)

  if (venuesError) {
    logger.error('slot-release-notices: failed to fetch venues', {
      action: 'cron.slot_release_notices',
      errorMessage: venuesError.message,
    })
    return NextResponse.json({ error: venuesError.message }, { status: 500 })
  }

  for (const venue of (venues ?? []) as unknown as Venue[]) {
    results.venues++
    const timezone = venue.timezone || AVIARA_TIMEZONE
    const hours = venue.slot_release_notice_hours ?? DEFAULT_NOTICE_HOURS
    const minPlayers = venue.slot_release_notice_min_players ?? DEFAULT_NOTICE_MIN_PLAYERS
    const to = parseEmailList(venue.slot_release_notice_to)
    const cc = parseEmailList(venue.slot_release_notice_cc)

    if (to.length === 0) {
      logger.warn('slot-release-notices: venue switched on with no club address', {
        action: 'cron.slot_release_notices',
        metadata: { course_id: venue.id },
      })
      continue
    }

    // Tee times whose notice could fall on this run: `hours` ahead, give or
    // take a day for the venue's timezone.
    const target = new Date(now.getTime() + hours * 60 * 60 * 1000)
    const fetchFrom = format(subDays(target, 1), 'yyyy-MM-dd')
    const fetchTo = format(addDays(target, 1), 'yyyy-MM-dd')

    const { data: seats, error: seatsError } = await admin
      .from('bookings')
      .select('booking_date, tee_time, member_id, player_member_id, guest_name, playing_host, created_at')
      .eq('course_id', venue.id)
      .not('status', 'in', '("cancelled","waitlist")')
      .gte('booking_date', fetchFrom)
      .lte('booking_date', fetchTo)

    if (seatsError) {
      results.errors++
      logger.error('slot-release-notices: failed to fetch bookings', {
        action: 'cron.slot_release_notices',
        metadata: { course_id: venue.id },
        errorMessage: seatsError.message,
      })
      continue
    }

    const due = groupTeeTimes((seats ?? []) as NoticeSeatRow[]).filter(
      g => isNoticeDue(g.date, g.teeTime, timezone, hours, now),
    )
    results.checked += due.length

    for (const group of due) {
      if (group.players >= minPlayers) {
        results.skipped++
        continue
      }

      const hostId = noticeHostId(group, venue.playing_host_member_id)
      const { data: host } = await admin
        .from('members')
        .select('first_name, last_name, email')
        .eq('id', hostId)
        .maybeSingle()
      const hostName =
        nameOrEmail(host ? `${host.first_name ?? ''} ${host.last_name ?? ''}` : '', host?.email) || 'LinkUp Golf'

      const values = { hostName, date: group.date, teeTime: group.teeTime, players: group.players }
      const recipients = noticeRecipients(to, cc, production)
      if (recipients.to.length === 0) {
        // A test deployment with no copy address: nobody to show it to.
        results.skipped++
        continue
      }

      // Claim the tee time. A second run that gets here first wins; this one stops.
      const { data: claim, error: claimError } = await admin
        .from('slot_release_notices')
        .upsert(
          {
            course_id: venue.id,
            booking_date: group.date,
            tee_time: group.teeTime,
            players: group.players,
            host_name: hostName,
            sent_to: [...recipients.to, ...recipients.cc].join(', '),
          },
          { onConflict: 'course_id,booking_date,tee_time', ignoreDuplicates: true },
        )
        .select('id')

      if (claimError) {
        results.errors++
        logger.error('slot-release-notices: failed to claim tee time', {
          action: 'cron.slot_release_notices',
          metadata: { course_id: venue.id, date: group.date, tee_time: group.teeTime },
          errorMessage: claimError.message,
        })
        continue
      }
      const claimId = claim?.[0]?.id as string | undefined
      if (!claimId) {
        results.skipped++
        continue
      }

      const text = fillNoticeBody(venue.slot_release_notice_body, values)
      const subject = `${recipients.heldBack ? '[Test] ' : ''}${noticeSubject(venue.name, values)}`
      const html = text
        .split(/\n{2,}/)
        .map(p => `<p style="margin:0 0 14px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
        .join('')

      const result = await sendEmail({
        to: recipients.to,
        cc: recipients.cc,
        // A reply from the club reaches our people, not the no-reply sender.
        replyTo: cc.length ? cc : undefined,
        subject,
        html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937">${html}</div>`,
        text,
      })

      if (result.sent > 0) {
        results.sent++
        logger.info('slot-release-notices: sent', {
          action: 'cron.slot_release_notices',
          metadata: {
            course_id: venue.id,
            date: group.date,
            tee_time: group.teeTime,
            players: group.players,
            held_back: recipients.heldBack,
          },
        })
      } else {
        // Release the claim so the next run in the window tries again.
        results.errors++
        await admin.from('slot_release_notices').delete().eq('id', claimId)
        logger.error('slot-release-notices: email not sent', {
          action: 'cron.slot_release_notices',
          metadata: { course_id: venue.id, date: group.date, tee_time: group.teeTime, skipped: result.skipped },
        })
      }
    }
  }

  logger.info('slot-release-notices cron complete', { action: 'cron.slot_release_notices', metadata: results })
  return NextResponse.json({ ok: true, ...results })
}
