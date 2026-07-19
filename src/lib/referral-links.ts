// ============================================================
// LinkUp Golf — Attributing contacts to a referral partner
// Server-side only. Shared by the admin "refer contacts" action and the
// import of a partner-submitted referral list, so both agree on what
// attribution means.
//
// referral_partner_links carries a global UNIQUE(email): a contact belongs to
// exactly one partner, because attribution decides who gets paid. The two
// callers differ only in what should happen when a contact is already claimed:
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

  const [{ data: existingLinks }, { data: memberRows }] = await Promise.all([
    admin.from('referral_partner_links').select('id, email, referral_partner_id').in('email', emails),
    admin.from('members').select('id, email, ghl_contact_id').in('email', emails),
  ])

  const linkByEmail = new Map(
    ((existingLinks ?? []) as ExistingLink[]).map(l => [l.email.toLowerCase(), l])
  )
  const memberByEmail = new Map(
    ((memberRows ?? []) as MemberRow[]).map(m => [m.email.toLowerCase(), m])
  )

  const outcomes: LinkOutcome[] = []

  for (const [email, target] of byEmail) {
    if (!validateEmail(email).valid) {
      outcomes.push({ email, status: 'skipped', reason: 'Not a valid email address' })
      continue
    }

    const existing = linkByEmail.get(email)
    const member = memberByEmail.get(email) ?? null

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

      outcomes.push(error
        ? { email, status: 'skipped', reason: 'Could not move this contact' }
        : { email, status: 'linked', linkId: existing.id, memberId: member?.id ?? null })
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
      // The unique constraint is the race-safe backstop for the check above.
      outcomes.push({
        email,
        status: 'skipped',
        reason: error.code === '23505'
          ? 'Already attributed to another referral partner'
          : 'Could not record this referral',
      })
      continue
    }

    outcomes.push({ email, status: 'linked', linkId: inserted.id, memberId: member?.id ?? null })
  }

  return outcomes
}
