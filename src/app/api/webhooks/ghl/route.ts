export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/webhooks/ghl
// Receives GHL contact changes: an access tag added or removed, a profile
// field edited. Delegates all sync logic to the shared sync orchestrator in
// src/lib/sync.
//
// GHL WORKFLOW SETUP (one workflow covers it)
//   Triggers : Contact Tag (added or removed), Contact Changed
//   Action   : Webhook (or Custom Webhook), POST
//   URL      : https://app.linkup.golf/api/webhooks/ghl
//   Header   : x-linkup-secret: <GHL_WEBHOOK_SECRET>
//   Body     : the standard payload works (it carries contact_id), or
//              {"contactId": "{{contact.id}}"}
// Accepted headers and bodies are in @/lib/ghl/contact-webhook.
//
// Without it, a removed tag reaches the app when the member next makes a
// request (withAuth re-checks GHL and re-syncs), or at the nightly reconcile.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase-server'
import { getContactById } from '@/lib/ghl/client'
import { contactIdFromWebhook, verifyContactWebhook } from '@/lib/ghl/contact-webhook'
import { syncMemberByContactId, type SyncContext } from '@/lib/sync'
import { invalidateMembershipCache } from '@/lib/auth/ghl-validator'
import { getCache } from '@/lib/cache'
import { MEMBER_ROW_NS, memberRowKey } from '@/lib/cache/keys'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const requestId = randomUUID()
  const log = logger.child({ requestId, action: 'ghl_webhook' })

  const body = await request.text()

  const verified = verifyContactWebhook({
    body,
    sharedSecretHeader: request.headers.get('x-linkup-secret'),
    signatureHeader: request.headers.get('x-ghl-signature'),
    secret: process.env.GHL_WEBHOOK_SECRET,
  })
  if (!verified) {
    log.warn('Invalid webhook secret or signature')
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const contactId = contactIdFromWebhook(payload)
  if (!contactId) {
    log.debug('Webhook names no contact change — ignored')
    return NextResponse.json({ received: true })
  }

  log.info('GHL contact webhook received', { metadata: { contactId } })

  const contact = await getContactById(contactId)
  if (!contact) return NextResponse.json({ received: true })

  const ctx: SyncContext = { supabase: createAdminClient(), requestId }

  // The row follows GHL: an access tag makes them an active member. Losing
  // every access tag after being a member makes them a former member
  // (@/lib/auth/former-member), off the directory at once; anyone else
  // without one is a non-member guest. syncMemberByContactId skips a contact
  // nobody has signed in as yet.
  const result = await syncMemberByContactId({ contact, ctx })

  // withAuth reads tags from two caches (GHL's, 15 min; the member row's,
  // 5 min). Clear both, so a change takes effect on the member's next request.
  if (result.userId) {
    await invalidateMembershipCache(result.userId)
    await getCache(MEMBER_ROW_NS).delete(memberRowKey(result.userId)).catch(() => {})
  }

  return NextResponse.json({ received: true })
}
