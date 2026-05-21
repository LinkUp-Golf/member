export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/admin/sync
// Bulk-imports all GHL contacts with any access tag into
// Supabase — creating auth users for new contacts and running
// the full member sync for each.
//
// Idempotent: safe to run multiple times.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/auth/with-auth'
import { createAdminClient } from '@/lib/supabase-server'
import { listContactsByTag } from '@/lib/ghl/client'
import { syncMember } from '@/lib/sync'
import { ALL_ACCESS_TAGS } from '@/lib/ghl/tags'
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

    for (const tag of ALL_ACCESS_TAGS) {
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

    log.info('Bulk sync complete', { metadata: { total: contacts.length, synced, skipped, errors: errors.length } })

    return NextResponse.json({
      total: contacts.length,
      synced,
      skipped,
      errors,
    })
  },
  { requireAdmin: true, skipGHLCheck: true }
)
