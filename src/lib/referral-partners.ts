// ============================================================
// LinkUp Golf — Referral partner analytics helpers
// Server-side only. Resolves each partner's referrals into conversions and
// computes commission from them.
//
// A referral converts — and earns commission — when the referred person has
// actually PAID: i.e. they have a member row (matched by the link's email or a
// backfilled member_id) with at least one booking in a paid state
// (payment_confirmed / confirmed, the same states the app counts as revenue).
// Membership status is deliberately NOT used: it mirrors a GHL access tag, not
// a payment. A booking payment is real money.
//
// This is why a referred non-member needs no special handling: once they join
// through the normal flow (a member row appears with their email) and make
// their first paid booking, the read-time match picks them up. Nothing is
// pre-created.
//
// The conversion date is the earliest paid booking's date, snapshotted onto
// the link so monthly payouts stay attributable even if bookings change later.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { commissionForRate, isWithinRateWindow } from '@/lib/referral-rate'
import type { ReferralPartnerStats } from '@/types'

type AdminClient = SupabaseClient

// Booking states that represent money actually received — mirrors the app's
// own revenue definition (see admin/bookings revenue calc).
export const PAID_BOOKING_STATUSES = ['payment_confirmed', 'confirmed'] as const

/** The subset of a partner row needed to price a conversion. */
export interface PartnerRate {
  id: string
  percentage: number
  ends_at?: string | null
}

/** One referral that has become a paying member (has a paid booking). */
export interface ReferralConversion {
  linkId: string
  partnerId: string
  memberId: string | null
  email: string
  name: string | null
  /** YYYY-MM-DD of the referral's first paid booking. */
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

  // Resolve each link's email to a member (for the id, to look up bookings, and
  // for a display name). Emails are stored lowercased on link rows.
  const emails = [...new Set(rows.map(r => r.email.toLowerCase()))]
  const { data: memberData } = await admin
    .from('members')
    .select('id, email, first_name, last_name')
    .in('email', emails)

  const membersByEmail = new Map(
    ((memberData ?? []) as MemberRow[]).map(m => [m.email.toLowerCase(), m])
  )

  // Candidate member ids: those matched by email, plus any already backfilled
  // onto a link (covers a member whose email later diverged from the link).
  const memberIds = new Set<string>()
  for (const m of (memberData ?? []) as MemberRow[]) memberIds.add(m.id)
  for (const r of rows) if (r.member_id) memberIds.add(r.member_id)

  // Earliest paid booking per member — the conversion event and its date.
  const firstPaidByMember = new Map<string, string>()
  if (memberIds.size) {
    const { data: bookings } = await admin
      .from('bookings')
      .select('member_id, created_at')
      .in('member_id', [...memberIds])
      .in('status', PAID_BOOKING_STATUSES as unknown as string[])
      .order('created_at', { ascending: true })

    for (const b of (bookings ?? []) as Array<{ member_id: string; created_at: string }>) {
      if (!firstPaidByMember.has(b.member_id)) {
        firstPaidByMember.set(b.member_id, b.created_at.slice(0, 10))
      }
    }
  }

  const rateByPartner = new Map(partners.map(p => [p.id, p]))
  // Conversion dates we resolved but that aren't yet snapshotted on the link.
  const toStamp: Array<{ id: string; converted_at: string }> = []

  for (const row of rows) {
    links.get(row.referral_partner_id)?.push(row)

    const rate = rateByPartner.get(row.referral_partner_id)
    if (!rate) continue

    const member = membersByEmail.get(row.email.toLowerCase()) ?? null
    const memberId = row.member_id ?? member?.id ?? null
    if (!memberId) continue // no member row → cannot have paid → not converted

    const convertedAt = firstPaidByMember.get(memberId)
    if (!convertedAt) continue // member exists but has no paid booking → not converted

    if (row.converted_at?.slice(0, 10) !== convertedAt) {
      toStamp.push({ id: row.id, converted_at: convertedAt })
    }

    const withinRateWindow = isWithinRateWindow(convertedAt, rate.ends_at)
    conversions.get(row.referral_partner_id)?.push({
      linkId: row.id,
      partnerId: row.referral_partner_id,
      memberId,
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
    // activeCount = referrals who have paid (converted).
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
