// Verifying that a webhook really came from Resend.
//
// Resend signs with Svix's scheme, which is three headers and one HMAC:
//
//   svix-id          the delivery's own id
//   svix-timestamp   unix seconds
//   svix-signature   one or more space-separated "v1,<base64 sig>" values,
//                    because a secret being rotated means two are valid at once
//
// The signed content is `${id}.${timestamp}.${rawBody}` and the key is the
// base64 body of the whsec_… secret. Implemented here rather than by adding
// the svix package: it is twenty lines, and a webhook verifier is exactly the
// kind of thing worth being able to read.
//
// Pure and exported so it can be tested without a network or a secret in the
// environment — a signature check that has never been run against a bad
// signature is a signature check nobody should trust.

import { createHmac, timingSafeEqual } from 'crypto'

/**
 * How far out of date a delivery may be, in seconds.
 *
 * Svix's own tolerance. It's what stops a signed request captured off the wire
 * from being replayed indefinitely; five minutes is long enough to survive a
 * retry and a clock that's a little out.
 */
export const SVIX_TOLERANCE_SECONDS = 5 * 60

export interface SvixHeaders {
  id: string | null
  timestamp: string | null
  signature: string | null
}

/** Why a delivery was rejected — logged, never returned to the caller. */
export type SvixFailure =
  | 'no-secret'
  | 'missing-headers'
  | 'bad-timestamp'
  | 'stale-timestamp'
  | 'no-match'

export function verifySvixSignature(params: {
  headers: SvixHeaders
  body: string
  secret: string | undefined
  /** Unix seconds; injectable so the tolerance can be tested. */
  now?: number
}): { ok: true } | { ok: false; reason: SvixFailure } {
  const { headers, body } = params
  const secret = params.secret?.trim()
  if (!secret) return { ok: false, reason: 'no-secret' }
  if (!headers.id || !headers.timestamp || !headers.signature) {
    return { ok: false, reason: 'missing-headers' }
  }

  const sent = Number.parseInt(headers.timestamp, 10)
  if (!Number.isFinite(sent)) return { ok: false, reason: 'bad-timestamp' }

  const now = params.now ?? Math.floor(Date.now() / 1000)
  if (Math.abs(now - sent) > SVIX_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'stale-timestamp' }
  }

  // 'whsec_' is a label on the secret, not part of the key.
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', key)
    .update(`${headers.id}.${headers.timestamp}.${body}`)
    .digest('base64')

  // Any one of the offered signatures matching is enough; a rotation puts the
  // old and the new secret's signatures in the same header.
  for (const part of headers.signature.split(' ')) {
    const value = part.startsWith('v1,') ? part.slice(3) : ''
    if (!value) continue
    const a = Buffer.from(value)
    const b = Buffer.from(expected)
    if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true }
  }

  return { ok: false, reason: 'no-match' }
}

// ---- Reading the event --------------------------------------

/** The shape of a Resend webhook, narrowed to the parts we act on. */
export interface ResendWebhookEvent {
  type?: string
  data?: {
    email_id?: string
    to?: string[] | string
    subject?: string
    bounce?: { type?: string; subType?: string; message?: string }
    /** Present on email.complained in some payload versions. */
    complaint?: { type?: string }
  }
}

/**
 * Whether a bounce means "never try again".
 *
 * A transient bounce is a full mailbox or a server having a bad afternoon, and
 * suppressing on one would quietly delete a live member from every future
 * notification. Only a permanent bounce is a fact about the address, so anything
 * Resend doesn't call permanent is left alone — under-suppressing is
 * recoverable and over-suppressing is invisible.
 */
export function isHardBounce(bounceType: string | null | undefined): boolean {
  return (bounceType ?? '').trim().toLowerCase() === 'permanent'
}

/** Every address a webhook event concerns. */
export function eventAddresses(event: ResendWebhookEvent): string[] {
  const to = event.data?.to
  if (Array.isArray(to)) return to.filter((a): a is string => typeof a === 'string')
  return typeof to === 'string' ? [to] : []
}
