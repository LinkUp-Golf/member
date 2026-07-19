// ============================================================
// LinkUp Golf — Attributing contacts to a referral partner
// Server-side only. Shared by the admin "refer contacts" action and the
// import of a partner-submitted referral list, so both agree on what
// attribution means.
//
// A person is referred exactly once, because attribution decides who gets
// paid. "Once" is enforced on two keys, both backed by DB constraints:
//
//   email     — UNIQUE(email) on referral_partner_links.
//   member_id — partial UNIQUE where member_id IS NOT NULL.
//
// The member key is what stops the same person being referred twice under two
// different addresses (personal vs work, say). Email alone would let that
// through, and they'd be counted twice in stats and paid twice in commission.
//
// The two callers differ only in what should happen when a person is already
// claimed:
//
//   repoint: true  — an admin deliberately moving a contact between partners.
//   repoint: false — importing a partner's own submission. Another partner's
//                    contact is left alone and reported back as skipped, so a
//                    partner can't claim someone by listing them.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { validateEmail } from '@/lib/validation'
import { findOrCreateContactByEmail } from '@/lib/ghl/client'

type AdminClient = SupabaseClient

export interface LinkTarget {
  email: string
  /** Used to name a newly-created CRM contact for a non-member. */
  name?: string | null
}

export type LinkOutcome =
  /** Newly attributed to this partner (or moved here from another). */
  | { email: string; status: 'linked'; linkId: string | null; memberId: string | null }
  /**
   * Already attributed to this same partner — the desired state already holds.
   * Distinct from 'skipped' because callers disagree about it: re-saving an
   * admin selection is an idempotent success, while a partner re-submitting
   * someone should be told it wasn't a new referral.
   */
  | { email: string; status: 'already'; linkId: string }
  | { email: string; status: 'skipped'; reason: string }

interface ExistingLink {
  id: string
  email: string
  referral_partner_id: string
  member_id: string | null
}

interface MemberRow {
  id: string
  email: string
  ghl_contact_id: string | null
}

function splitName(name?: string | null): { firstName: string | null; lastName: string | null } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { firstName: null, lastName: null }
  return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(' ') || null }
}

/**
 * Attribute a set of contacts to a partner, one outcome per input email.
 * Emails are normalised to lowercase (link rows store them that way, which is
 * what makes the uniqueness check and the members lookup exact).
 */
export async function linkTargetsToPartner(
  admin: AdminClient,
  partnerId: string,
  targets: LinkTarget[],
  { repoint = false }: { repoint?: boolean } = {}
): Promise<LinkOutcome[]> {
  // Dedupe by email, keeping the first name given for each.
  const byEmail = new Map<string, LinkTarget>()
  for (const t of targets) {
    const email = t.email.trim().toLowerCase()
    if (email && !byEmail.has(email)) byEmail.set(email, { ...t, email })
  }
  if (!byEmail.size) return []

  const emails = [...byEmail.keys()]

  const [{ data: linksByEmailRows }, { data: memberRows }] = await Promise.all([
    admin.from('referral_partner_links').select('id, email, referral_partner_id, member_id').in('email', emails),
    admin.from('members').select('id, email, ghl_contact_id').in('email', emails),
  ])

  const linkByEmail = new Map(
    ((linksByEmailRows ?? []) as ExistingLink[]).map(l => [l.email.toLowerCase(), l])
  )
  const memberByEmail = new Map(
    ((memberRows ?? []) as MemberRow[]).map(m => [m.email.toLowerCase(), m])
  )

  // A person can be referred once, and a member is the same person whichever
  // address they're listed under. Looking up only by email would miss someone
  // already referred at a different address — they'd be attributed twice and
  // counted twice in commission. So resolve members to their existing link too.
  const memberIds = [...memberByEmail.values()].map(m => m.id)
  const { data: linksByMemberRows } = memberIds.length
    ? await admin
        .from('referral_partner_links')
        .select('id, email, referral_partner_id, member_id')
        .in('member_id', memberIds)
    : { data: [] as ExistingLink[] }

  const linkByMemberId = new Map(
    ((linksByMemberRows ?? []) as ExistingLink[])
      .filter(l => l.member_id)
      .map(l => [l.member_id as string, l])
  )

  const outcomes: LinkOutcome[] = []
  // Members newly linked during this run, so a second row in the same batch
  // resolving to the same person can't slip past the pre-loop reads.
  const claimedMemberIds = new Set<string>()

  for (const [email, target] of byEmail) {
    if (!validateEmail(email).valid) {
      outcomes.push({ email, status: 'skipped', reason: 'Not a valid email address' })
      continue
    }

    const member = memberByEmail.get(email) ?? null

    if (member && claimedMemberIds.has(member.id)) {
      outcomes.push({ email, status: 'skipped', reason: 'Already referred in this list' })
      continue
    }

    // Match on the address first, then on the member behind it.
    const existing = linkByEmail.get(email) ?? (member ? linkByMemberId.get(member.id) : undefined)

    if (existing) {
      if (existing.referral_partner_id === partnerId) {
        outcomes.push({ email, status: 'already', linkId: existing.id })
        continue
      }
      if (!repoint) {
        outcomes.push({
          email,
          status: 'skipped',
          reason: 'Already attributed to another referral partner',
        })
        continue
      }

      const { error } = await admin
        .from('referral_partner_links')
        .update({
          referral_partner_id: partnerId,
          member_id: member?.id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)

      if (error) {
        outcomes.push({ email, status: 'skipped', reason: 'Could not move this contact' })
      } else {
        if (member) claimedMemberIds.add(member.id)
        outcomes.push({ email, status: 'linked', linkId: existing.id, memberId: member?.id ?? null })
      }
      continue
    }

    // A member already has a CRM contact; a non-member gets one created so the
    // referral exists as a lead. Best-effort — a GHL outage yields a null
    // contact id but still records the attribution.
    const { firstName, lastName } = splitName(target.name)
    const ghlContactId = member
      ? member.ghl_contact_id
      : await findOrCreateContactByEmail({ email, firstName, lastName })

    const { data: inserted, error } = await admin
      .from('referral_partner_links')
      .insert({
        referral_partner_id: partnerId,
        email,
        member_id: member?.id ?? null,
        ghl_contact_id: ghlContactId,
        status: 'linked',
      })
      .select('id')
      .single()

    if (error) {
      // The unique constraints on email and member_id are the race-safe
      // backstop for the checks above.
      outcomes.push({
        email,
        status: 'skipped',
        reason: error.code === '23505'
          ? 'Already referred'
          : 'Could not record this referral',
      })
      continue
    }

    if (member) claimedMemberIds.add(member.id)
    outcomes.push({ email, status: 'linked', linkId: inserted.id, memberId: member?.id ?? null })
  }

  return outcomes
}
