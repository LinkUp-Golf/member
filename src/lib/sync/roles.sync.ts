// ============================================================
// Provision the workspace role rows a GHL role tag implies.
//
// The GHL 'host' / 'referral-partner' tag is the authorization to be a host /
// referral partner. The workspaces are scoped by a DB row (hosts.id /
// referral_partners.id), so when the tag is present we make sure that row
// exists. Both helpers are idempotent — an existing row (e.g. one created by an
// admin-approved application) is left untouched, including its terms.
//
// Deliberately including `name`, which is the one exception to GHL being the
// source of truth across this module. It's seeded from the contact but it isn't
// the contact's name afterwards: approving a host application takes a name from
// the admin, and the admin referral UI can rename a partner. Both are usually a
// business ("Acme Golf Travel"), not a person. Refreshing it from GHL would
// undo that on the next login.
// ============================================================

import { logger } from '@/lib/logger'
import type { GHLContact } from '@/types'
import type { SyncContext } from './types'

function contactName(contact: GHLContact, fallback: string): string {
  return `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim() || fallback
}

/** Ensure the caller has a hosts row when they carry the host tag. */
export async function ensureHostRow(userId: string, contact: GHLContact, ctx: SyncContext): Promise<void> {
  const { data: existing } = await ctx.supabase
    .from('hosts')
    .select('id')
    .eq('member_id', userId)
    .maybeSingle()
  if (existing) return

  // `source` marks this as the unreviewed path so admins can tell an
  // auto-provisioned host from an approved one. venues_unrestricted stays at its
  // false default deliberately: the tag grants the role, not access to every
  // course on LinkUp. An admin grants venues (PUT /api/admin/hosts/[id]/venues),
  // which is also what the reviewed path does.
  const { error } = await ctx.supabase
    .from('hosts')
    .insert({
      member_id: userId,
      name: contactName(contact, 'Host'),
      status: 'active',
      source: 'ghl_tag',
    })
  // A concurrent sync may have created it (unique member_id) — not an error.
  if (error && error.code !== '23505') {
    logger.warn('ensureHostRow failed', { requestId: ctx.requestId, userId, errorMessage: error.message })
  }
}

// A readable-ish, unique public code for an auto-provisioned partner. The admin
// can rename it later; uniqueness is enforced by referral_partners_code_unique.
function candidateCode(name: string, attempt: number): string {
  const base = (name.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6)) || 'PARTNER'
  const suffix = Math.floor(1000 + Math.random() * 9000)
  return attempt === 0 ? `${base}${suffix}` : `${base}${suffix}${attempt}`
}

/** Ensure the caller has a referral_partners row when they carry the partner tag. */
export async function ensurePartnerRow(userId: string, contact: GHLContact, ctx: SyncContext): Promise<void> {
  const { data: existing } = await ctx.supabase
    .from('referral_partners')
    .select('id')
    .eq('member_id', userId)
    .maybeSingle()
  if (existing) return

  const name = contactName(contact, 'Referral Partner')

  // Retry on a code collision (23505). percentage defaults to the column
  // default (10%); an admin adjusts the terms in the admin referral UI.
  for (let attempt = 0; attempt < 5; attempt++) {
    const { error } = await ctx.supabase
      .from('referral_partners')
      .insert({ member_id: userId, name, code: candidateCode(name, attempt) })
    if (!error) return
    // Another sync created the member's row first (partial unique on member_id).
    if (error.code === '23505' && attempt > 0) {
      const { data: now } = await ctx.supabase
        .from('referral_partners').select('id').eq('member_id', userId).maybeSingle()
      if (now) return
    }
    if (error.code !== '23505') {
      logger.warn('ensurePartnerRow failed', { requestId: ctx.requestId, userId, errorMessage: error.message })
      return
    }
  }
  logger.warn('ensurePartnerRow gave up after code collisions', { requestId: ctx.requestId, userId })
}
