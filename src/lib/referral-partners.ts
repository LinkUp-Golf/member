// ============================================================
// LinkUp Golf — Referral partner analytics helpers
// Server-side only. Computes per-partner link/conversion stats and commission.
// "Converted" (paying) is reconciled on read from the member row's
// membership_status — not stored on the link — so it always reflects reality.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { MEMBERSHIP_FEE_USD } from '@/lib/constants'
import type { ReferralPartnerStats } from '@/types'

type AdminClient = SupabaseClient

export const emptyStats = (): ReferralPartnerStats => ({
  referredCount: 0,
  memberCount: 0,
  nonMemberCount: 0,
  activeCount: 0,
  commissionOwed: 0,
})

// Returns the set of emails (lowercased) that belong to an active paying member.
async function activeMemberEmails(admin: AdminClient, emails: string[]): Promise<Set<string>> {
  if (!emails.length) return new Set()
  const { data } = await admin
    .from('members')
    .select('email')
    .in('email', emails)
    .eq('membership_status', 'active')
  return new Set((data ?? []).map((m: { email: string }) => m.email.toLowerCase()))
}

// Compute stats for a set of partners in one pass. Emails are stored lowercased
// on link rows, so a direct `.in()` lookup against members is exact.
export async function computeStatsForPartners(
  admin: AdminClient,
  partners: Array<{ id: string; percentage: number }>
): Promise<Map<string, ReferralPartnerStats>> {
  const byPartner = new Map<string, ReferralPartnerStats>()
  for (const p of partners) byPartner.set(p.id, emptyStats())
  if (!partners.length) return byPartner

  const partnerIds = partners.map(p => p.id)
  const { data: links } = await admin
    .from('referral_partner_links')
    .select('referral_partner_id, email, member_id')
    .in('referral_partner_id', partnerIds)

  const rows = links ?? []
  const activeEmails = await activeMemberEmails(admin, [...new Set(rows.map(r => r.email))])

  for (const l of rows) {
    const s = byPartner.get(l.referral_partner_id)
    if (!s) continue
    s.referredCount++
    if (l.member_id) s.memberCount++
    else s.nonMemberCount++
    if (activeEmails.has(l.email.toLowerCase())) s.activeCount++
  }

  for (const p of partners) {
    const s = byPartner.get(p.id)
    if (s) s.commissionOwed = s.activeCount * MEMBERSHIP_FEE_USD * (Number(p.percentage) / 100)
  }

  return byPartner
}
