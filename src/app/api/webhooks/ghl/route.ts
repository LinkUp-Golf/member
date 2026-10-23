export const dynamic = 'force-dynamic'

// ============================================================
// POST /api/webhooks/ghl
// Receives GHL webhooks for contact changes.
// Secured by webhook secret. Delegates all sync logic to
// the shared sync orchestrator in src/lib/sync.
// ============================================================

import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import crypto, { randomUUID } from 'crypto'
import { createAdminClient } from '@/lib/supabase-server'
import { getContactById } from '@/lib/ghl/client'
import { syncMemberByContactId, type SyncContext } from '@/lib/sync'
import { invalidateMembershipCache } from '@/lib/auth/ghl-validator'
import { getCache } from '@/lib/cache'
import { MEMBER_ROW_NS, memberRowKey } from '@/lib/cache/keys'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const requestId = randomUUID()
  const log = logger.child({ requestId, action: 'ghl_webhook' })

  const signature = request.headers.get('x-ghl-signature')
  const body = await request.text()

  if (!verifyWebhookSignature(body, signature)) {
    log.warn('Invalid webhook signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let payload: { type?: string; contactId?: string } = {}
  try {
    payload = JSON.parse(body)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { type, contactId } = payload

  if (!contactId) {
    return NextResponse.json({ received: true })
  }

  log.info('GHL webhook received', { metadata: { type, contactId } })

  const ctx: SyncContext = {
    supabase: createAdminClient(),
    requestId,
  }

  switch (type) {
    case 'contact.created':
    case 'contact.updated':
    case 'contact.tag.added':
    case 'contact.tag.removed': {
      const contact = await getContactById(contactId)
      if (!contact) break

      // Tag added or removed, the row follows GHL: an access tag makes them an
      // active member, none makes them a non-member who can still sign in as a
      // guest. A removed tag no longer suspends — that's an admin's call.
      // syncMemberByContactId skips a contact nobody has signed in as yet.
      const result = await syncMemberByContactId({ contact, ctx })
      // withAuth reads tags from two caches (GHL's, 15 min; the member row's,
      // 5 min). Clear both, so a guest who has just become a member isn't kept
      // to guest pages until they expire — nor a lapsed member kept out of them.
      if (result.userId) {
        await invalidateMembershipCache(result.userId)
        await getCache(MEMBER_ROW_NS).delete(memberRowKey(result.userId)).catch(() => {})
      }
      break
    }

    default:
      log.debug('Unhandled webhook event type', { metadata: { type } })
  }

  return NextResponse.json({ received: true })
}

function verifyWebhookSignature(body: string, signature: string | null): boolean {
  if (!signature || !process.env.GHL_WEBHOOK_SECRET) return false
  const expected = crypto
    .createHmac('sha256', process.env.GHL_WEBHOOK_SECRET)
    .update(body)
    .digest('hex')
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
}
