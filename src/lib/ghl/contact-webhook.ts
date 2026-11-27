// ============================================================
// The GHL contact webhook's two pure questions: is this call really from
// us, and which contact is it about. POST /api/webhooks/ghl does the rest.
//
// AUTH — either of:
//   - Header x-linkup-secret: <GHL_WEBHOOK_SECRET>. What a GHL workflow's
//     Webhook / Custom Webhook action can send: it can set a fixed header but
//     can't sign the body. This is how the route is meant to be called.
//   - Header x-ghl-signature: hex HMAC-SHA256 of the body, keyed with
//     GHL_WEBHOOK_SECRET. The original scheme; kept so nothing already sending
//     it breaks, though GHL itself has no way to produce it.
//
// BODY — the contact id under any of the names GHL uses for it:
//   contactId (our own documented body), contact_id (a workflow Webhook
//   action's standard payload), id (GHL's own contact events). `type` is
//   optional: the route re-reads the contact from GHL either way, so the
//   event's name doesn't change what it does.
//
// Server-only (node:crypto).
// ============================================================

import crypto from 'crypto'

/** Constant-time string comparison that doesn't throw on a length mismatch. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && crypto.timingSafeEqual(x, y)
}

export function verifyContactWebhook(params: {
  body: string
  sharedSecretHeader: string | null
  signatureHeader: string | null
  secret: string | undefined
}): boolean {
  const { body, sharedSecretHeader, signatureHeader, secret } = params
  if (!secret) return false
  if (sharedSecretHeader) return safeEqual(sharedSecretHeader, secret)
  if (signatureHeader) {
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex')
    return safeEqual(signatureHeader, expected)
  }
  return false
}

/** Event names that mean "this contact may have changed". */
const CONTACT_EVENTS = new Set([
  'contact.created',
  'contact.updated',
  'contact.tag.added',
  'contact.tag.removed',
  // GHL's own names for the same events.
  'contactcreate',
  'contactupdate',
  'contacttagupdate',
])

/**
 * The contact a webhook body is about, or null when it names none or is an
 * event that isn't about a contact changing.
 */
export function contactIdFromWebhook(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null
  const p = payload as Record<string, unknown>

  const type = typeof p.type === 'string' ? p.type.trim().toLowerCase() : ''
  if (type && !CONTACT_EVENTS.has(type)) return null

  for (const key of ['contactId', 'contact_id', 'id'] as const) {
    const v = p[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}
