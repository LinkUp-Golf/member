export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/admin/sync
// Full reconcile of Supabase members against GHL, treating GHL
// as the source of truth:
//   1. Import/update every GHL contact holding an access tag
//      (creating auth users for new contacts).
//   2. Reconcile existing members GHL no longer tags — a member
//      whose access tag was removed (or whose contact was deleted)
//      in GHL is deactivated, so a cancellation propagates.
//
// Idempotent: safe to run multiple times.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { listContactsByTag } from '@/lib/ghl/client'
import { syncMember, refreshMembersFromGhl } from '@/lib/sync'
import { ALL_LOGIN_TAGS, hasAnyAccessTag } from '@/lib/ghl/tags'
import { logger } from '@/lib/logger'
import type { AuthContext } from '@/lib/auth/types'
import { randomUUID } from 'crypto'

export const POST = withAuth(
  async (_req: NextRequest, _ctx: AuthContext) => {
    const requestId = randomUUID()
    const log = logger.child({ requestId, action: 'bulk_ghl_sync' })
    const adminClient = createAdminClient()

    // ---- 1. Fetch all contacts with any access tag ----------
    // Fetch per-tag and deduplicate by contact ID (OR logic).
    const contactMap = new Map<string, (typeof contacts)[number]>()
    let contacts: Awaited<ReturnType<typeof listContactsByTag>> = []

    for (const tag of ALL_LOGIN_TAGS) {
      try {
        const page = await listContactsByTag(tag)
        for (const c of page) contactMap.set(c.id, c)
      } catch (err) {
        log.warn('Failed to fetch contacts for tag', { metadata: { tag, error: String(err) } })
      }
    }

    contacts = Array.from(contactMap.values())
    log.info('GHL contacts fetched', { metadata: { total: contacts.length } })

    // ---- 2. Sync each contact --------------------------------
    let synced = 0
    let skipped = 0
    const errors: string[] = []

    for (const contact of contacts) {
      try {
        if (!contact.email) {
          skipped++
          continue
        }

        // Don't provision an account for a contact GHL doesn't actually grant
        // access to — otherwise a contact returned without a usable access tag
        // would leave an orphaned auth user with no member row. syncMember would
        // skip it anyway; bail before creating the user.
        if (!hasAnyAccessTag(contact.tags ?? [])) {
          skipped++
          continue
        }

        // Check if a member row already exists (by email)
        const { data: existing } = await adminClient
          .from('members')
          .select('id')
          .eq('email', contact.email.toLowerCase())
          .single()

        let userId: string

        if (existing) {
          userId = existing.id
        } else {
          // Create a Supabase auth user — email confirmed, no password.
          // They log in via magic link when they first access the app.
          const { data: created, error: createErr } = await adminClient.auth.admin.createUser({
            email: contact.email,
            email_confirm: true,
            user_metadata: {
              ghl_contact_id: contact.id,
              first_name: contact.firstName,
              last_name: contact.lastName,
            },
          })

          if (createErr || !created.user) {
            errors.push(`${contact.email}: ${createErr?.message ?? 'unknown error'}`)
            continue
          }

          userId = created.user.id
        }

        const result = await syncMember({
          contact,
          userId,
          ctx: { supabase: adminClient, requestId },
        })

        if (result.success && result.action !== 'skipped') {
          synced++
        } else if (result.action === 'skipped') {
          skipped++
        } else {
          errors.push(`${contact.email}: sync failed — ${result.error ?? 'unknown'}`)
        }
      } catch (err) {
        errors.push(`${contact.email}: ${String(err)}`)
      }
    }

    // ---- 3. Reconcile members GHL no longer tags -------------
    // The import pass above only sees contacts that still hold an access tag.
    // A member whose tag was removed (cancelled) — or whose contact was deleted
    // — in GHL never appears there, so their status would stay 'active' forever.
    // Re-check exactly those members against GHL and deactivate the ones that
    // no longer qualify, so a cancellation in the source of truth propagates.
    let deactivated = 0
    const seenContactIds = new Set(contacts.map(c => c.id))

    const { data: existingMembers } = await adminClient
      .from('members')
      .select('id, ghl_contact_id, membership_status')
      .neq('membership_status', 'suspended')

    // Only members we didn't already sync this run, and only those we can look
    // up in GHL (a member with no ghl_contact_id can't be reconciled here).
    const stale = (existingMembers ?? []).filter(
      m => m.ghl_contact_id && !seenContactIds.has(m.ghl_contact_id)
    )

    if (stale.length) {
      const staleIds = stale.map(m => m.id)
      const { failed } = await refreshMembersFromGhl(
        stale.map(m => ({ id: m.id, ghl_contact_id: m.ghl_contact_id })),
        { supabase: adminClient, requestId }
      )

      // Count what actually got deactivated rather than inferring it: none of
      // the stale set was suspended before this run (we excluded suspended
      // above), so any now-suspended row was deactivated by this reconcile.
      // refreshMembersFromGhl leaves still-tagged members active, so this
      // doesn't overcount a member a stale fetch happened to miss.
      const { count } = await adminClient
        .from('members')
        .select('id', { count: 'exact', head: true })
        .in('id', staleIds)
        .eq('membership_status', 'suspended')
      deactivated = count ?? 0

      if (failed) errors.push(`${failed} member(s) could not be reconciled — GHL lookup failed`)
    }

    log.info('Bulk sync complete', { metadata: { total: contacts.length, synced, skipped, deactivated, errors: errors.length } })

    return NextResponse.json({
      total: contacts.length,
      synced,
      skipped,
      deactivated,
      errors,
    })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
