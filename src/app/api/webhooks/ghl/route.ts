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
import { hasAnyAccessTag } from '@/lib/ghl/tags'
import { syncMemberByContactId, type SyncContext } from '@/lib/sync'
import { deactivateMember } from '@/lib/sync/member.sync'
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

      if (hasAnyAccessTag(contact.tags ?? [])) {
        await syncMemberByContactId({ contact, ctx })
      } else {
        // Tag removed — deactivate the member if they exist in Supabase
        const { data: member } = await ctx.supabase
          .from('members')
          .select('id')
          .eq('ghl_contact_id', contactId)
          .single()

        if (member) {
          await deactivateMember(member.id, ctx)
        }
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
