// Addresses we've been told to stop mailing.
//
// Three ways an address gets here, and all three are the recipient's mail
// system telling us something we're obliged to act on: it bounced for good, the
// recipient marked it as spam, or they used the unsubscribe link. Carrying on
// after any of them is what turns a sending domain into a blocked one — bounce
// rate and complaint rate are the two numbers Gmail and Yahoo publish
// thresholds for, and both are measured against what we keep sending, not
// against what we were told once.
//
// Read on the way out (filterSuppressed, in ./send) and written by the two
// things that learn about it: the Resend webhook and the unsubscribe endpoint.
//
// Nothing here throws. A suppression table that can't be read must not take
// the email channel down with it — so a failed read sends to everyone, which
// is the behaviour we had before this existed, and a failed write is logged
// and swallowed. Both are loud in the log precisely because neither is visible
// anywhere else.

import { createAdminClient } from '@/lib/supabase-server'
import { logger } from '@/lib/logger'
import { maskEmail } from './client'

/** Why an address is on the list. Mirrors the CHECK on the table. */
export const SUPPRESSION_REASONS = ['bounced', 'complained', 'unsubscribed'] as const
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number]

/**
 * The one spelling of an address this system stores and compares.
 *
 * Mailbox providers treat the local part as case-sensitive in theory and never
 * in practice; what matters here is that the address a webhook reports and the
 * address on the member row compare equal, and those two come from different
 * places. Returns '' for anything that isn't an address, which callers drop.
 */
export function normaliseAddress(value: string | null | undefined): string {
  const trimmed = (value ?? '').trim().toLowerCase()
  return trimmed.includes('@') ? trimmed : ''
}

/**
 * Stops mailing these addresses.
 *
 * Upserts, so a complaint after a bounce updates the reason rather than
 * failing on the primary key — the most recent thing the recipient's mail
 * system told us is the one worth keeping.
 */
export async function suppress(
  addresses: string[],
  reason: SuppressionReason,
  detail?: string | null,
): Promise<number> {
  const rows = Array.from(new Set(addresses.map(normaliseAddress).filter(Boolean))).map(
    email => ({
      email,
      reason,
      detail: detail?.slice(0, 500) ?? null,
      updated_at: new Date().toISOString(),
    }),
  )
  if (rows.length === 0) return 0

  const { error } = await createAdminClient()
    .from('email_suppressions')
    .upsert(rows, { onConflict: 'email' })

  if (error) {
    logger.error('Could not record email suppression', {
      action: 'email.suppression_failed',
      errorCode: error.code,
      errorMessage: error.message,
      metadata: { reason, addresses: rows.length, to: rows.slice(0, 5).map(r => maskEmail(r.email)) },
    })
    return 0
  }

  logger.info('Email suppressed', {
    action: 'email.suppressed',
    metadata: { reason, addresses: rows.length, to: rows.slice(0, 5).map(r => maskEmail(r.email)) },
  })
  return rows.length
}

/** Lets us mail an address again. Admin-initiated; nothing automatic calls it. */
export async function unsuppress(addresses: string[]): Promise<number> {
  const emails = Array.from(new Set(addresses.map(normaliseAddress).filter(Boolean)))
  if (emails.length === 0) return 0

  const { error } = await createAdminClient()
    .from('email_suppressions')
    .delete()
    .in('email', emails)

  if (error) {
    logger.error('Could not lift email suppression', {
      action: 'email.unsuppress_failed',
      errorCode: error.code,
      errorMessage: error.message,
      metadata: { addresses: emails.length },
    })
    return 0
  }
  return emails.length
}

/** Which of these addresses are on the list. Empty when it can't be read. */
export async function suppressedAmong(addresses: string[]): Promise<Set<string>> {
  const emails = Array.from(new Set(addresses.map(normaliseAddress).filter(Boolean)))
  if (emails.length === 0) return new Set()

  const { data, error } = await createAdminClient()
    .from('email_suppressions')
    .select('email')
    .in('email', emails)

  if (error) {
    // Fail open. A notification that should have been withheld and wasn't is a
    // worse email; a notification withheld from everyone because one table was
    // unreadable is a broken product.
    logger.error('Could not read email suppressions; sending to everyone', {
      action: 'email.suppression_read_failed',
      errorCode: error.code,
      errorMessage: error.message,
      metadata: { asked: emails.length },
    })
    return new Set()
  }

  return new Set((data ?? []).map(r => r.email as string))
}

/**
 * Splits addresses into the ones we may mail and the ones we may not.
 *
 * Pure-ish: the only I/O is the lookup above, and the partitioning is the part
 * worth being sure of, so it's done here rather than at each call site.
 */
export async function filterSuppressed(
  addresses: string[],
): Promise<{ allowed: string[]; suppressed: string[] }> {
  const normalised = Array.from(
    new Set(addresses.map(normaliseAddress).filter(Boolean)),
  )
  if (normalised.length === 0) return { allowed: [], suppressed: [] }

  const blocked = await suppressedAmong(normalised)
  const allowed: string[] = []
  const suppressed: string[] = []
  for (const email of normalised) {
    ;(blocked.has(email) ? suppressed : allowed).push(email)
  }
  return { allowed, suppressed }
}
