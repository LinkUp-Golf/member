// Reading and writing the state the email policy decides on.
//
// ./policy holds the rules and is pure; this holds the two database round
// trips that feed them, and the record of what was sent. Kept apart so the
// rules can be tested without a database and changed without touching SQL.

import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
import {
  CAP_WINDOW_MS,
  categoryFor,
  notificationKey,
  throttleDecision,
  type EmailCategory,
  type ThrottleState,
} from './policy'

export interface ThrottleOutcome {
  /** Members who may be emailed this notification now. */
  allowed: string[]
  /** Members who may not, and the rule that stopped each. */
  suppressed: { memberId: string; reason: string }[]
  category: EmailCategory
  key: string
}

/**
 * Splits a set of members into those this notification may be emailed to now
 * and those it may not.
 *
 * Two queries for the whole set rather than two per member: one for what each
 * has had recently of any kind (the cap), one for when each last had this kind
 * (the cooldown). Transactional notifications skip both — they're never
 * suppressed, and asking would only add latency to the mail that matters most.
 */
export async function filterByThrottle(
  memberIds: string[],
  tag: string | undefined,
): Promise<ThrottleOutcome> {
  const key = notificationKey(tag)
  const category = categoryFor(tag)
  const ids = Array.from(new Set(memberIds.filter(Boolean)))

  if (ids.length === 0) return { allowed: [], suppressed: [], category, key }

  // A transactional notification is never suppressed, so its state is never
  // consulted. The send is still recorded — it counts towards everyone else's
  // cap, which is the point of counting it.
  if (category === 'transactional') {
    return { allowed: ids, suppressed: [], category, key }
  }

  const since = new Date(Date.now() - CAP_WINDOW_MS).toISOString()
  const admin = createAdminClient()

  const [windowRes, lastRes] = await Promise.all([
    admin
      .from('email_send_log')
      .select('member_id')
      .in('member_id', ids)
      .gte('sent_at', since),
    admin
      .from('email_send_log')
      .select('member_id, sent_at')
      .in('member_id', ids)
      .eq('notification_key', key)
      .order('sent_at', { ascending: false }),
  ])

  if (windowRes.error || lastRes.error) {
    // Fail open. A throttle that can't read its own state must not become a
    // reason nobody hears from us; a duplicate email is the cheaper mistake.
    logger.warn('Email throttle state unavailable — sending anyway', {
      action: 'email.throttle_unavailable',
      errorMessage: (windowRes.error ?? lastRes.error)?.message,
      metadata: { key, category, members: ids.length },
    })
    return { allowed: ids, suppressed: [], category, key }
  }

  const sentInWindow = new Map<string, number>()
  for (const row of windowRes.data ?? []) {
    const id = row.member_id as string
    sentInWindow.set(id, (sentInWindow.get(id) ?? 0) + 1)
  }

  // Ordered newest first, so the first row seen for a member is their latest.
  const lastSentAt = new Map<string, string>()
  for (const row of lastRes.data ?? []) {
    const id = row.member_id as string
    if (!lastSentAt.has(id)) lastSentAt.set(id, row.sent_at as string)
  }

  const allowed: string[] = []
  const suppressed: { memberId: string; reason: string }[] = []

  for (const id of ids) {
    const state: ThrottleState = {
      lastSentAt: lastSentAt.get(id) ?? null,
      sentInWindow: sentInWindow.get(id) ?? 0,
    }
    const decision = throttleDecision(category, state)
    if (decision.send) allowed.push(id)
    else suppressed.push({ memberId: id, reason: decision.reason })
  }

  return { allowed, suppressed, category, key }
}

/**
 * Records that these members were emailed this notification.
 *
 * Written after the provider accepts it, so a rejected send doesn't spend a
 * member's budget. Never throws: failing to record costs at worst a second
 * email, while failing the caller would cost the notification itself.
 */
export async function recordEmailsSent(
  memberIds: string[],
  key: string,
  category: EmailCategory,
): Promise<void> {
  const ids = Array.from(new Set(memberIds.filter(Boolean)))
  if (ids.length === 0) return

  const { error } = await createAdminClient()
    .from('email_send_log')
    .insert(ids.map(id => ({ member_id: id, notification_key: key, category })))

  if (error) {
    logger.warn('Could not record email sends', {
      action: 'email.record_failed',
      errorMessage: error.message,
      metadata: { key, category, members: ids.length },
    })
  }
}
