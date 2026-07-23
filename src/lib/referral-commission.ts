// ============================================================
// LinkUp Golf — Recurring referral commission engine
//
// A partner earns `percentage`% of the membership fee EACH month a referred
// member stays a paying member, for up to COMMISSION_TERM_MONTHS months, ending
// the month the member cancels. Commission accrues into a running balance; a
// partner is paid out once that balance clears PAYOUT_THRESHOLD_USD, and the
// remainder rolls over to the next run.
//
// The pure maths (accruedMonths / monthlyCommission / computeBalance) is
// isomorphic and unit-tested; the DB loaders are server-only. Nothing here is
// stored — accrual is derived on read from each member's membership dates, so a
// membership that starts, cancels, or is re-synced is always reflected live.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { MEMBERSHIP_FEE_USD, COMMISSION_TERM_MONTHS, PAYOUT_THRESHOLD_USD } from '@/lib/constants'
import { sumCents } from '@/lib/referral-rate'
import { hasMembershipTag } from '@/lib/ghl/tags'

type AdminClient = SupabaseClient

/** Whole-cents commission earned per active month at the given rate. */
export function monthlyCommission(percentage: number): number {
  return Math.round(MEMBERSHIP_FEE_USD * Number(percentage)) / 100
}

/** Zero-based month index for a YYYY-MM-DD date — for month arithmetic. */
function monthIndex(date: string): number {
  const y = Number(date.slice(0, 4))
  const m = Number(date.slice(5, 7))
  return y * 12 + (m - 1)
}

/**
 * How many months a referred membership earns commission for:
 *   - starts the month the membership began,
 *   - runs for at most `term` months,
 *   - never into a future month,
 *   - stops at the cancellation month (endDate), inclusive,
 *   - never past the partner's rate expiry (endsAt), if one is set.
 * All bounds are inclusive month counts, so a membership that starts and ends in
 * the same month still earns one month.
 */
export function accruedMonths(params: {
  startDate: string
  endDate?: string | null
  today: string
  endsAt?: string | null
  term?: number
}): number {
  const { startDate, endDate, today, endsAt, term = COMMISSION_TERM_MONTHS } = params
  const startM = monthIndex(startDate)
  let lastM = Math.min(monthIndex(today), startM + term - 1)
  if (endDate) lastM = Math.min(lastM, monthIndex(endDate))
  if (endsAt) lastM = Math.min(lastM, monthIndex(endsAt))
  return Math.max(0, lastM - startM + 1)
}

/** A referred member who has (or had) a membership and so accrues commission. */
export interface AccruingMember {
  linkId: string
  memberId: string | null
  email: string
  name: string | null
  /** membership_start_date, YYYY-MM-DD. */
  startDate: string
  /** Cancellation month source (membership_ended_at), or null while still active. */
  endDate: string | null
}

export interface MemberAccrual extends AccruingMember {
  months: number
  accrued: number
}

/** Price each member's accrual at the partner's rate. */
export function memberAccruals(
  members: AccruingMember[],
  percentage: number,
  today: string,
  endsAt?: string | null
): MemberAccrual[] {
  const monthly = monthlyCommission(percentage)
  return members.map(m => {
    const months = accruedMonths({ startDate: m.startDate, endDate: m.endDate, today, endsAt })
    return { ...m, months, accrued: Math.round(months * monthly * 100) / 100 }
  })
}

export interface PartnerBalance {
  totalAccrued: number
  totalPaid: number
  /** Accrued minus paid; negative means the partner was paid ahead. */
  outstanding: number
  /** True once the outstanding balance reaches the payout threshold. */
  payable: boolean
  threshold: number
}

export function computeBalance(
  totalAccrued: number,
  totalPaid: number,
  threshold = PAYOUT_THRESHOLD_USD
): PartnerBalance {
  const outstanding = Math.round((totalAccrued - totalPaid) * 100) / 100
  return { totalAccrued, totalPaid, outstanding, payable: outstanding >= threshold, threshold }
}

// ---- DB loaders (server-only) -------------------------------

const todayISO = () => new Date().toISOString().slice(0, 10)

interface MemberRow {
  id: string
  email: string
  first_name: string
  last_name: string
  ghl_tags: string[] | null
  membership_start_date: string | null
  membership_ended_at: string | null
}

/**
 * The partner's referred members that have ever held a membership, with the
 * dates that bound their accrual. A member still tagged in GHL is active
 * (endDate null); one no longer tagged is cancelled — its membership_ended_at,
 * falling back to today when the cancellation date was never stamped.
 */
export async function loadAccruingMembers(
  admin: AdminClient,
  partnerId: string
): Promise<AccruingMember[]> {
  const { data: linkData } = await admin
    .from('referral_partner_links')
    .select('id, member_id, email')
    .eq('referral_partner_id', partnerId)

  const links = (linkData ?? []) as Array<{ id: string; member_id: string | null; email: string }>
  if (!links.length) return []

  const COLS = 'id, email, first_name, last_name, ghl_tags, membership_start_date, membership_ended_at'
  const emails = [...new Set(links.map(l => l.email.toLowerCase()))]
  const memberIds = [...new Set(links.map(l => l.member_id).filter((v): v is string => !!v))]

  const [{ data: byEmail }, { data: byId }] = await Promise.all([
    admin.from('members').select(COLS).in('email', emails),
    memberIds.length
      ? admin.from('members').select(COLS).in('id', memberIds)
      : Promise.resolve({ data: [] as MemberRow[] }),
  ])

  const memberByEmail = new Map(((byEmail ?? []) as MemberRow[]).map(m => [m.email.toLowerCase(), m]))
  const memberById = new Map(
    [...((byEmail ?? []) as MemberRow[]), ...((byId ?? []) as MemberRow[])].map(m => [m.id, m])
  )

  const today = todayISO()
  const out: AccruingMember[] = []
  for (const link of links) {
    const member =
      (link.member_id ? memberById.get(link.member_id) : undefined) ??
      memberByEmail.get(link.email.toLowerCase()) ??
      null

    // Never held a membership → nothing accrues.
    if (!member?.membership_start_date) continue

    const active = hasMembershipTag(member.ghl_tags ?? [])
    const endDate = active ? null : (member.membership_ended_at?.slice(0, 10) ?? today)

    out.push({
      linkId: link.id,
      memberId: member.id,
      email: link.email,
      name: `${member.first_name} ${member.last_name}`.trim() || null,
      startDate: member.membership_start_date.slice(0, 10),
      endDate,
    })
  }
  return out
}

export interface PartnerPayoutRow {
  id: string
  amount: number
  method: string
  reference: string | null
  note: string | null
  paid_at: string
  paid_by: string | null
}

/** A partner's payout history, newest first. */
export async function loadPartnerPayouts(admin: AdminClient, partnerId: string): Promise<PartnerPayoutRow[]> {
  const { data } = await admin
    .from('referral_partner_payments')
    .select('id, amount, method, reference, note, paid_at, paid_by')
    .eq('referral_partner_id', partnerId)
    .order('paid_at', { ascending: false })
  return ((data ?? []) as PartnerPayoutRow[]).map(p => ({ ...p, amount: Number(p.amount) }))
}

export interface PartnerCommissionSummary {
  accruals: MemberAccrual[]
  payouts: PartnerPayoutRow[]
  balance: PartnerBalance
  monthlyRate: number
}

/** Everything the commission UI needs for one partner: per-member accrual, payouts, and the balance. */
export async function loadPartnerCommission(
  admin: AdminClient,
  partner: { id: string; percentage: number; ends_at?: string | null }
): Promise<PartnerCommissionSummary> {
  const [members, payouts] = await Promise.all([
    loadAccruingMembers(admin, partner.id),
    loadPartnerPayouts(admin, partner.id),
  ])

  const accruals = memberAccruals(members, partner.percentage, todayISO(), partner.ends_at ?? null)
  const totalAccrued = sumCents(accruals.map(a => a.accrued))
  const totalPaid = sumCents(payouts.map(p => p.amount))

  return {
    accruals,
    payouts,
    balance: computeBalance(totalAccrued, totalPaid),
    monthlyRate: monthlyCommission(partner.percentage),
  }
}
