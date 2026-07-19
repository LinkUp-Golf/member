// ============================================================
// LinkUp Golf — Referral partner analytics helpers
// Server-side only. Resolves each partner's referrals into conversions and
// computes commission from them.
//
// Two things are deliberately reconciled on read rather than stored:
//   - *Whether* a referral is active — taken from the member row's
//     membership_status, so it always reflects reality.
//   - *When* it converted — taken from members.membership_start_date, which
//     is accurate retroactively (a link created today for a member who joined
//     in March is attributed to March, not today).
// The conversion date is then snapshotted onto the link row, because monthly
// payouts must stay attributable even if the member row is later edited or
// unlinked. See supabase/migrations/20260719000000_referral_partner_rate_end.sql.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { commissionForRate, isWithinRateWindow } from '@/lib/referral-rate'
import type { ReferralPartnerStats } from '@/types'

type AdminClient = SupabaseClient

/** The subset of a partner row needed to price a conversion. */
export interface PartnerRate {
  id: string
  percentage: number
  ends_at?: string | null
}

/** One referral that has become a paying member. */
export interface ReferralConversion {
  linkId: string
  partnerId: string
  memberId: string | null
  email: string
  name: string | null
  /** YYYY-MM-DD the referral became a paying member. */
  convertedAt: string
  /** Commission earned — 0 when the conversion falls outside the rate window. */
  commission: number
  /** False when the conversion post-dates the partner's ends_at. */
  withinRateWindow: boolean
}

export const emptyStats = (): ReferralPartnerStats => ({
  referredCount: 0,
  memberCount: 0,
  nonMemberCount: 0,
  activeCount: 0,
  commissionOwed: 0,
})

export interface LinkRow {
  id: string
  referral_partner_id: string
  member_id: string | null
  email: string
  converted_at: string | null
  created_at: string
}

interface MemberRow {
  email: string
  first_name: string
  last_name: string
  membership_status: string
  membership_start_date: string | null
}

/**
 * Resolve every partner's referrals into conversions, priced against that
 * partner's rate and rate window. Returns conversions keyed by partner id
 * alongside the raw link rows (so callers can derive counts without re-querying).
 */
export async function loadPartnerConversions(
  admin: AdminClient,
  partners: PartnerRate[]
): Promise<{
  links: Map<string, LinkRow[]>
  conversions: Map<string, ReferralConversion[]>
}> {
  const links = new Map<string, LinkRow[]>()
  const conversions = new Map<string, ReferralConversion[]>()
  for (const p of partners) {
    links.set(p.id, [])
    conversions.set(p.id, [])
  }
  if (!partners.length) return { links, conversions }

  const { data: linkData } = await admin
    .from('referral_partner_links')
    .select('id, referral_partner_id, member_id, email, converted_at, created_at')
    .in('referral_partner_id', partners.map(p => p.id))

  const rows = (linkData ?? []) as LinkRow[]
  if (!rows.length) return { links, conversions }

  // Emails are stored lowercased on link rows, so a direct `.in()` is exact.
  const emails = [...new Set(rows.map(r => r.email.toLowerCase()))]
  const { data: memberData } = await admin
    .from('members')
    .select('email, first_name, last_name, membership_status, membership_start_date')
    .in('email', emails)

  const membersByEmail = new Map(
    ((memberData ?? []) as MemberRow[]).map(m => [m.email.toLowerCase(), m])
  )
  const rateByPartner = new Map(partners.map(p => [p.id, p]))

  // Conversion dates we resolved but that aren't yet snapshotted on the link.
  const toStamp: Array<{ id: string; converted_at: string }> = []

  for (const row of rows) {
    links.get(row.referral_partner_id)?.push(row)

    const member = membersByEmail.get(row.email.toLowerCase())
    if (member?.membership_status !== 'active') continue

    // membership_start_date is the truth; fall back to a previously stamped
    // date, then to when the referral was recorded.
    const convertedAt = (
      member.membership_start_date ?? row.converted_at ?? row.created_at
    ).slice(0, 10)

    if (row.converted_at?.slice(0, 10) !== convertedAt) {
      toStamp.push({ id: row.id, converted_at: convertedAt })
    }

    const rate = rateByPartner.get(row.referral_partner_id)
    if (!rate) continue

    const withinRateWindow = isWithinRateWindow(convertedAt, rate.ends_at)
    conversions.get(row.referral_partner_id)?.push({
      linkId: row.id,
      partnerId: row.referral_partner_id,
      memberId: row.member_id,
      email: row.email,
      name: `${member.first_name} ${member.last_name}`.trim() || null,
      convertedAt,
      commission: withinRateWindow ? commissionForRate(rate.percentage) : 0,
      withinRateWindow,
    })
  }

  // Best-effort snapshot — a failure here only means we recompute next read.
  if (toStamp.length) {
    void Promise.all(
      toStamp.map(s =>
        admin
          .from('referral_partner_links')
          .update({ converted_at: s.converted_at, status: 'converted' })
          .eq('id', s.id)
      )
    ).catch(() => {})
  }

  return { links, conversions }
}

/**
 * Derive stats from an already-loaded set of links and conversions. Split out
 * so a caller that needs both the stats and the conversion detail (the partner
 * overview endpoint) can load once instead of querying twice.
 */
export function statsFromLoaded(
  partners: PartnerRate[],
  links: Map<string, LinkRow[]>,
  conversions: Map<string, ReferralConversion[]>
): Map<string, ReferralPartnerStats> {
  const byPartner = new Map<string, ReferralPartnerStats>()
  for (const p of partners) byPartner.set(p.id, emptyStats())

  for (const p of partners) {
    const s = byPartner.get(p.id)
    if (!s) continue

    for (const l of links.get(p.id) ?? []) {
      s.referredCount++
      if (l.member_id) s.memberCount++
      else s.nonMemberCount++
    }

    const partnerConversions = conversions.get(p.id) ?? []
    s.activeCount = partnerConversions.length
    s.commissionOwed = partnerConversions.reduce((sum, c) => sum + c.commission, 0)
  }

  return byPartner
}

/** Compute stats for a set of partners in one pass. */
export async function computeStatsForPartners(
  admin: AdminClient,
  partners: PartnerRate[]
): Promise<Map<string, ReferralPartnerStats>> {
  if (!partners.length) return new Map()
  const { links, conversions } = await loadPartnerConversions(admin, partners)
  return statsFromLoaded(partners, links, conversions)
}
