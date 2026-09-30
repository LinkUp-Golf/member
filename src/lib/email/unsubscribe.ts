// The link that lets someone stop, without an account or a support email.
//
// Gmail and Yahoo have required this of anyone sending in volume since
// February 2024: a one-click unsubscribe header, honoured within two days, and
// a complaint rate kept under 0.3%. The two requirements are the same
// requirement — a reader with no way out marks the mail as spam instead, and a
// complaint costs the sending domain far more than an unsubscribe does.
//
// The link has to work from an inbox, so it can't sit behind a session: the
// address is carried in the token itself and signed, which makes the token
// both the identity and the proof. Signed rather than random so nothing needs
// storing per recipient — every email can mint its own, and a token can't be
// altered into somebody else's address.
//
// Not a bearer credential. It grants exactly one action, unsubscribing, which
// its holder could achieve anyway by marking the mail as spam. It deliberately
// does not expire: an unsubscribe link in a year-old email must still work,
// and an expired one is a complaint waiting to happen.

import { createHmac, timingSafeEqual } from 'crypto'

/** Where the link points. Public, and in middleware's PUBLIC_ROUTES. */
export const UNSUBSCRIBE_PATH = '/api/email/unsubscribe'

/**
 * What the token is signed with.
 *
 * EMAIL_UNSUBSCRIBE_SECRET when it's set, and the service-role key otherwise —
 * the strongest secret this server already has, and one that is never sent
 * anywhere. The fallback exists so the channel's compliance doesn't depend on
 * someone remembering a new environment variable; rotating to a dedicated
 * secret invalidates outstanding links, which is why it isn't the other way
 * round.
 */
function signingKey(): string {
  return process.env.EMAIL_UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}

const b64url = (value: Buffer | string): string =>
  Buffer.from(value as never).toString('base64url')

function sign(address: string, key: string): string {
  return createHmac('sha256', key).update(address).digest('base64url')
}

/**
 * A token carrying this address and a signature over it.
 *
 * Returns '' when there's no key to sign with, which the callers treat as "no
 * unsubscribe link" rather than an unsigned one — a link that unsubscribes
 * whoever the query string names is worse than no link at all.
 */
export function unsubscribeToken(address: string): string {
  const email = address.trim().toLowerCase()
  const key = signingKey()
  if (!email || !key) return ''
  return `${b64url(email)}.${sign(email, key)}`
}

/**
 * The address a token vouches for, or null if it doesn't.
 *
 * Compared in constant time — not because the timing of an unsubscribe is
 * worth much, but because a signature check that leaks is a habit, and this is
 * the same three lines everywhere else it matters.
 */
export function verifyUnsubscribeToken(token: string | null | undefined): string | null {
  const key = signingKey()
  if (!token || !key) return null

  const dot = token.indexOf('.')
  if (dot < 1) return null

  let email: string
  try {
    email = Buffer.from(token.slice(0, dot), 'base64url').toString('utf8').trim().toLowerCase()
  } catch {
    return null
  }
  if (!email.includes('@')) return null

  const given = Buffer.from(token.slice(dot + 1))
  const wanted = Buffer.from(sign(email, key))
  if (given.length !== wanted.length) return null
  return timingSafeEqual(given, wanted) ? email : null
}
