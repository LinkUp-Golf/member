// ============================================================
// LinkUp Golf — Referral partner analytics helpers
// Server-side only. Resolves each partner's referrals into conversions and
// computes commission from them.
//
// A referral converts — and earns commission — when the referred person holds
// a MEMBERSHIP, identified by a GHL membership tag ('avi member' /
// 'avi member - active') on their member row's ghl_tags. Commission is a reward
// for bringing in a member, not for a round played, so it is deliberately NOT
// tied to bookings: someone can pay for membership long before (or without
// ever) booking an event.
//
// GHL is the source of truth for membership, so ghl_tags must be current before
// commission is paid — the payment flow re-syncs the partner's referred members
// from GHL first (see src/lib/referral-sync.ts).
//
// The conversion date is the member's membership_start_date, snapshotted onto
// the link so monthly payouts stay attributable even if the member row changes.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { commissionForRate, isWithinRateWindow, sumCents } from '@/lib/referral-rate'
import { hasMembershipTag } from '@/lib/ghl/tags'
import type { ReferralPartnerStats } from '@/types'

type AdminClient = SupabaseClient

/** The subset of a partner row needed to price a conversion. */
export interface PartnerRate {
  id: string
  percentage: number
  ends_at?: string | null
}

/** One referral that has become a member. */
export interface ReferralConversion {
  linkId: string
  partnerId: string
  memberId: string | null
  email: string
  name: string | null
  /** YYYY-MM-DD the referral became a member. */
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
  id: string
  email: string
  first_name: string
  last_name: string
  ghl_tags: string[] | null
  membership_start_date: string | null
}

// The membership signal that counts as "converted": a GHL membership tag on
// the member's synced tags. GHL is the source of truth, so the payment flow
// refreshes these tags before paying (see src/lib/referral-sync.ts).
function isPayingMember(member: MemberRow | null | undefined): boolean {
  return hasMembershipTag(member?.ghl_tags ?? [])
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

  const MEMBER_COLS = 'id, email, first_name, last_name, ghl_tags, membership_start_date'

  // Resolve each link to a member — by email (how links are keyed) and, for a
  // manually-linked referral whose member email later diverged, by member_id.
  const emails = [...new Set(rows.map(r => r.email.toLowerCase()))]
  const linkMemberIds = [...new Set(rows.map(r => r.member_id).filter((v): v is string => !!v))]

  const [{ data: byEmailData }, { data: byIdData }] = await Promise.all([
    admin.from('members').select(MEMBER_COLS).in('email', emails),
    linkMemberIds.length
      ? admin.from('members').select(MEMBER_COLS).in('id', linkMemberIds)
      : Promise.resolve({ data: [] as MemberRow[] }),
  ])

  const memberByEmail = new Map(
    ((byEmailData ?? []) as MemberRow[]).map(m => [m.email.toLowerCase(), m])
  )
  const memberById = new Map(
    ([...((byEmailData ?? []) as MemberRow[]), ...((byIdData ?? []) as MemberRow[])]).map(m => [m.id, m])
  )

  const rateByPartner = new Map(partners.map(p => [p.id, p]))
  // Conversion dates we resolved but that aren't yet snapshotted on the link.
  const toStamp: Array<{ id: string; converted_at: string }> = []

  for (const row of rows) {
    links.get(row.referral_partner_id)?.push(row)

    const rate = rateByPartner.get(row.referral_partner_id)
    if (!rate) continue

    const member =
      (row.member_id ? memberById.get(row.member_id) : undefined) ??
      memberByEmail.get(row.email.toLowerCase()) ??
      null

    if (!isPayingMember(member)) continue // not a member → not converted

    // membership_start_date is the truth; fall back to a previously stamped
    // date, then to when the referral was recorded.
    const convertedAt = (
      member?.membership_start_date ?? row.converted_at ?? row.created_at
    ).slice(0, 10)

    if (row.converted_at?.slice(0, 10) !== convertedAt) {
      toStamp.push({ id: row.id, converted_at: convertedAt })
    }

    const withinRateWindow = isWithinRateWindow(convertedAt, rate.ends_at)
    conversions.get(row.referral_partner_id)?.push({
      linkId: row.id,
      partnerId: row.referral_partner_id,
      memberId: row.member_id ?? member?.id ?? null,
      email: row.email,
      name: member ? `${member.first_name} ${member.last_name}`.trim() || null : null,
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
    // activeCount = referrals who became members (converted).
    s.activeCount = partnerConversions.length
    s.commissionOwed = sumCents(partnerConversions.map(c => c.commission))
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
