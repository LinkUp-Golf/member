// ============================================================
// LinkUp Golf — Member credit wallet
// One wallet per member, whatever earned the credit (hosting an event, a
// referral payout, an admin adjustment). The ledger is append-only with signed
// amounts (earned +, redeemed -, adjusted ±), so a balance is simply the sum.
// These helpers derive the earned / redeemed / balance triad and load history.
//
// Credit is spendable on golf or membership — including by a host who holds no
// golf membership of their own — so nothing here gates on membership status.
//
// Nothing in this file imports server-only code: summarizeCredits is pure and
// the loaders take a client as a parameter, so a client component can import a
// sibling of theirs without dragging next/headers into its bundle. Redemption,
// which does send notifications, lives in ./redeem for that reason.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import type { CreditEntry, CreditSummary } from '@/types'

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
): CreditSummary {
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

/** A member's credit summary (earned / redeemed / balance). */
export async function loadCreditSummary(
  admin: AdminClient,
  memberId: string
): Promise<CreditSummary> {
  const { data } = await admin
    .from('credit_ledger')
    .select('kind, amount')
    .eq('member_id', memberId)

  return summarizeCredits((data ?? []) as { amount: number }[])
}

/** A member's full ledger, newest first. */
export async function loadCreditEntries(
  admin: AdminClient,
  memberId: string
): Promise<CreditEntry[]> {
  const { data } = await admin
    .from('credit_ledger')
    .select('*')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })

  return (data ?? []) as CreditEntry[]
}
