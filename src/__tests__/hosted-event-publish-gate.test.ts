import { describe, it, expect, vi } from 'vitest'

// A host-created event lands in 'pending_approval' and is invisible to members
// until an admin approves it — that's when the LinkUp team has set up the GHL
// calendar the event books against. Nothing in code can check the calendar
// exists, so these rules are the whole gate: publishing an event with no
// calendar behind it is exactly what they prevent.
//
// This gate has been removed twice before under other names ('pending_review',
// 'draft'). These tests are what makes its absence a failing test rather than a
// silently republished event.

vi.mock('@/lib/supabase-server', () => ({ createAdminClient: vi.fn() }))

import {
  APPROVABLE_STATUSES,
  REJECTABLE_STATUSES,
  canApproveEvent,
  canRejectEvent,
  canUploadProof,
  isMemberVisible,
  loadHostStats,
} from '@/lib/hosts/events'
import { NotificationTemplates } from '@/lib/push'

const today = '2026-08-14'

describe('canApproveEvent', () => {
  it('publishes an event awaiting approval', () => {
    expect(canApproveEvent('pending_approval', '2026-08-20', today)).toEqual({ ok: true })
  })

  it('publishes an event dated today', () => {
    // The round hasn't been played yet — a member can still take a spot in it.
    expect(canApproveEvent('pending_approval', today, today)).toEqual({ ok: true })
  })

  it('refuses an event whose date has passed', () => {
    // Approving would list a round nobody can attend. The reason matters: the
    // admin's way out is a takedown, not a retry, and the route says so.
    expect(canApproveEvent('pending_approval', '2026-08-13', today)).toEqual({
      ok: false,
      reason: 'past_date',
    })
  })

  it('refuses an event that is already live', () => {
    // Re-approving is meaningless, and would reset reviewed_by/reviewed_at on
    // something members are already holding spots in.
    expect(canApproveEvent('upcoming', '2026-08-20', today)).toEqual({ ok: false, reason: 'status' })
  })

  it('refuses events that have already run or been called off', () => {
    for (const status of ['completed', 'pending_credit_approval', 'credits_awarded', 'cancelled']) {
      expect(canApproveEvent(status, '2026-08-20', today)).toEqual({ ok: false, reason: 'status' })
    }
  })

  it('checks the status before the date', () => {
    // A cancelled past event is refused for being cancelled — otherwise the
    // admin is told to "take it down instead" about something already down.
    expect(canApproveEvent('cancelled', '2026-08-01', today)).toEqual({ ok: false, reason: 'status' })
  })

  it('only ever approves out of pending_approval', () => {
    expect([...APPROVABLE_STATUSES]).toEqual(['pending_approval'])
  })
})

describe('canRejectEvent', () => {
  it('takes down an event still waiting for approval', () => {
    expect(canRejectEvent('pending_approval')).toBe(true)
  })

  it('takes down a live event', () => {
    expect(canRejectEvent('upcoming')).toBe(true)
  })

  it('refuses an event that has already run', () => {
    // It happened. A takedown would rewrite history rather than prevent it.
    expect(canRejectEvent('completed')).toBe(false)
    expect(canRejectEvent('pending_credit_approval')).toBe(false)
    expect(canRejectEvent('credits_awarded')).toBe(false)
  })

  it('refuses an event already cancelled', () => {
    expect(canRejectEvent('cancelled')).toBe(false)
  })

  it('covers both pre-run states', () => {
    expect([...REJECTABLE_STATUSES].sort()).toEqual(['pending_approval', 'upcoming'])
  })
})

describe('isMemberVisible', () => {
  it('hides an event awaiting approval', () => {
    // Browse filters to 'upcoming', but a bare id would still resolve on the
    // single-event route — which would make this a listing filter, not a gate.
    expect(isMemberVisible('pending_approval')).toBe(false)
  })

  it('shows every other state', () => {
    for (const status of ['upcoming', 'completed', 'pending_credit_approval', 'credits_awarded', 'cancelled']) {
      expect(isMemberVisible(status)).toBe(true)
    }
  })
})

describe('canUploadProof on a pending event', () => {
  it('refuses proof for an event that was never published', () => {
    // Nothing ran, so there is nothing to claim credit for — including on a
    // pending event whose date has since gone by.
    expect(canUploadProof('pending_approval', '2026-08-20', today)).toBe(false)
    expect(canUploadProof('pending_approval', '2026-08-01', today)).toBe(false)
  })
})

describe('NotificationTemplates for the gate', () => {
  it('tells the host their event is now live', () => {
    const payload = NotificationTemplates.hostedEventApproved('Aviara Golf Club', '2026-08-20')

    expect(payload.body).toContain('Aviara Golf Club')
    expect(payload.body).toContain('2026-08-20')
    expect(payload.url).toBe('/host/events')
  })

  it('asks admins to approve rather than announcing a live listing', () => {
    // The submission push used to read "New hosted event is live". With the gate
    // in place that is false, and it's the message that decides whether anyone
    // treats the queue as work.
    const payload = NotificationTemplates.hostedEventNeedsReview('Wren', 'Aviara Golf Club', '2026-08-20')

    expect(payload.title).not.toContain('live')
    expect(payload.body).toContain('Wren')
    expect(payload.url).toBe('/admin/hosts')
  })
})

describe('loadHostStats', () => {
  // Minimal stand-in for the two queries loadHostStats makes: the host's event
  // statuses, and (via loadCreditSummary) an empty credit ledger.
  function fakeAdmin(statuses: string[]) {
    return {
      from: (table: string) => ({
        select: () => ({
          eq: () => Promise.resolve({
            data: table === 'hosted_events' ? statuses.map(status => ({ status })) : [],
            error: null,
          }),
        }),
      }),
    }
  }

  it('counts events awaiting approval in their own bucket', async () => {
    // Without this a host whose events are all pending sees zero upcoming, zero
    // completed, zero cancelled — and reasonably concludes they were lost.
    const stats = await loadHostStats(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeAdmin(['pending_approval', 'pending_approval', 'upcoming', 'completed', 'cancelled']) as any,
      'host-1',
      'member-1',
    )

    expect(stats.pendingCount).toBe(2)
    expect(stats.upcomingCount).toBe(1)
    expect(stats.completedCount).toBe(1)
    expect(stats.cancelledCount).toBe(1)
    expect(stats.totalEvents).toBe(5)
  })

  it('does not count a pending event as upcoming', async () => {
    // 'Upcoming' on the host dashboard says "open for reservations", which a
    // pending event is not — the reserve RPC refuses it.
    const stats = await loadHostStats(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fakeAdmin(['pending_approval']) as any,
      'host-1',
      'member-1',
    )

    expect(stats.upcomingCount).toBe(0)
    expect(stats.pendingCount).toBe(1)
  })
})
