// ============================================================
// LinkUp Golf — Host credits
// The credit ledger is append-only with signed amounts (earned +, redeemed -,
// adjusted ±); a host's balance is simply the sum. These helpers derive the
// earned / redeemed / balance triad and load a host's ledger.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { HostCreditEntry, HostCreditSummary } from '@/types'

type AdminClient = SupabaseClient

/** Round to whole cents, guarding against float drift and negative zero. */
const round2 = (n: number) => {
  const r = Math.round(n * 100) / 100
  return r === 0 ? 0 : r
}

/**
 * Earned / redeemed / balance from ledger rows. Positive movements (earned and
 * any positive adjustment) count toward earned; negative ones (redeemed and any
 * negative adjustment) toward redeemed, reported as a positive magnitude.
 */
export function summarizeCredits(
  entries: { amount: number }[]
): HostCreditSummary {
  let earned = 0
  let redeemed = 0
  let balance = 0

  for (const e of entries) {
    const amount = Number(e.amount)
    balance += amount
    if (amount >= 0) earned += amount
    else redeemed += amount
  }

  return {
    earned: round2(earned),
    redeemed: round2(-redeemed), // stored negative; present as a positive figure
    balance: round2(balance),
  }
}

/** A host's credit summary (earned / redeemed / balance). */
export async function loadCreditSummary(
  admin: AdminClient,
  hostId: string
): Promise<HostCreditSummary> {
  const { data } = await admin
    .from('host_credit_ledger')
    .select('kind, amount')
    .eq('host_id', hostId)

  return summarizeCredits((data ?? []) as { amount: number }[])
}

/** A host's full ledger, newest first. */
export async function loadCreditEntries(
  admin: AdminClient,
  hostId: string
): Promise<HostCreditEntry[]> {
  const { data } = await admin
    .from('host_credit_ledger')
    .select('*')
    .eq('host_id', hostId)
    .order('created_at', { ascending: false })

  return (data ?? []) as HostCreditEntry[]
}
