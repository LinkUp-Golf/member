// ============================================================
// LinkUp Golf — Refresh a partner's referred members from GHL
// Server-side only. Membership (the thing commission is paid on) lives in GHL
// as a tag, so before we compute or pay commission we re-pull the current tags
// for every member this partner has referred. This is what keeps a payout from
// running on a membership that GHL has since granted or revoked.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js'
import { refreshMembersFromGhl } from '@/lib/sync'

type AdminClient = SupabaseClient

/**
 * Re-sync every member referred by a partner from GHL. Resolves the referred
 * members two ways — by the link's backfilled member_id and by the link's
 * email — since a referral may not have been backfilled yet. Returns how many
 * were refreshed. Best-effort: a GHL hiccup on one member doesn't abort the rest.
 */
export async function syncPartnerReferredMembers(
  admin: AdminClient,
  partnerId: string,
  requestId?: string
): Promise<{ refreshed: number; failed: number }> {
  const { data: links } = await admin
    .from('referral_partner_links')
    .select('member_id, email')
    .eq('referral_partner_id', partnerId)

  const rows = links ?? []
  if (!rows.length) return { refreshed: 0, failed: 0 }

  const memberIds = [...new Set(rows.map(r => r.member_id).filter((v): v is string => !!v))]
  const emails = [...new Set(rows.map(r => r.email.toLowerCase()))]

  const [{ data: byId }, { data: byEmail }] = await Promise.all([
    memberIds.length
      ? admin.from('members').select('id, ghl_contact_id').in('id', memberIds)
      : Promise.resolve({ data: [] as Array<{ id: string; ghl_contact_id: string | null }> }),
    emails.length
      ? admin.from('members').select('id, ghl_contact_id').in('email', emails)
      : Promise.resolve({ data: [] as Array<{ id: string; ghl_contact_id: string | null }> }),
  ])

  // Dedupe by member id — the two lookups overlap for backfilled links.
  const membersById = new Map<string, { id: string; ghl_contact_id: string | null }>()
  for (const m of [...(byId ?? []), ...(byEmail ?? [])]) membersById.set(m.id, m)

  if (!membersById.size) return { refreshed: 0, failed: 0 }

  return refreshMembersFromGhl([...membersById.values()], { supabase: admin, requestId })
}
