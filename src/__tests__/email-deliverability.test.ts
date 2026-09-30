import { describe, it, expect } from 'vitest'
import { createHmac } from 'crypto'
import {
  unsubscribeToken,
  verifyUnsubscribeToken,
  UNSUBSCRIBE_PATH,
} from '@/lib/email/unsubscribe'
import {
  eventAddresses,
  isHardBounce,
  verifySvixSignature,
  SVIX_TOLERANCE_SECONDS,
} from '@/lib/email/webhook'
import { normaliseAddress, SUPPRESSION_REASONS } from '@/lib/email/suppression'
import { listUnsubscribeHeaders, unsubscribeUrl } from '@/lib/email/send'
import { renderNotificationEmail, type NotificationEmail } from '@/lib/email/template'

// The three things that decide whether LinkUp's mail keeps arriving: a reader
// can get out in one click, an address that bounced or complained stops being
// mailed, and only Resend can tell us it did. None of the three is visible in
// the app, so a regression in any of them would be found by a mailbox provider
// before it was found by us.

// setup.ts sets SUPABASE_SERVICE_ROLE_KEY, which is what the token falls back
// to signing with.

describe('unsubscribe tokens', () => {
  it('carries the address it was minted for, and hands it back', () => {
    const token = unsubscribeToken('Dana@Example.com')
    expect(verifyUnsubscribeToken(token)).toBe('dana@example.com')
  })

  it('is stable, so the link in an old email still works', () => {
    expect(unsubscribeToken('dana@example.com')).toBe(unsubscribeToken('dana@example.com'))
  })

  it('does not let one address be swapped for another', () => {
    // The whole point of signing it: the address is in the token, so without
    // this anyone could unsubscribe anybody by editing a query string.
    const token = unsubscribeToken('dana@example.com')
    const signature = token.slice(token.indexOf('.'))
    const forged = Buffer.from('victim@example.com').toString('base64url') + signature
    expect(verifyUnsubscribeToken(forged)).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const token = unsubscribeToken('dana@example.com')
    expect(verifyUnsubscribeToken(`${token}x`)).toBeNull()
    expect(verifyUnsubscribeToken(token.slice(0, -1))).toBeNull()
  })

  it('rejects rubbish rather than throwing', () => {
    for (const bad of ['', 'nodot', '.', 'a.b', Buffer.from('nope').toString('base64url') + '.x']) {
      expect(verifyUnsubscribeToken(bad)).toBeNull()
    }
    expect(verifyUnsubscribeToken(null)).toBeNull()
    expect(verifyUnsubscribeToken(undefined)).toBeNull()
  })

  it('mints a link a mail client can POST to', () => {
    const url = unsubscribeUrl('dana@example.com')
    expect(url).toContain(UNSUBSCRIBE_PATH)
    // The token rides in the query string, so it has to survive being one.
    const token = new URL(url).searchParams.get('t')
    expect(verifyUnsubscribeToken(token)).toBe('dana@example.com')
  })

  it('offers no link at all when there is nobody to unsubscribe', () => {
    expect(unsubscribeToken('')).toBe('')
    expect(unsubscribeUrl('')).toBe('')
    expect(listUnsubscribeHeaders('')).toEqual({})
  })
})

describe('List-Unsubscribe headers', () => {
  // RFC 8058. Gmail and Yahoo require these of bulk senders, and a reader
  // without the button reports the mail as spam instead — which costs the
  // sending domain what an unsubscribe doesn't.
  it('advertises one-click unsubscribe in the form clients look for', () => {
    const headers = listUnsubscribeHeaders('https://app.linkup.golf/api/email/unsubscribe?t=a.b')
    expect(headers['List-Unsubscribe']).toBe('<https://app.linkup.golf/api/email/unsubscribe?t=a.b>')
    expect(headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click')
  })
})

describe('the email footer', () => {
  const base = (over: Partial<NotificationEmail> = {}): NotificationEmail => ({
    heading: 'Your round is confirmed',
    body: 'Aviara on Saturday at 1:30pm.',
    ctaUrl: 'https://app.linkup.golf/book',
    ctaLabel: 'Pay for your round',
    logoUrl: 'https://app.linkup.golf/logos/logo-full-color.png',
    settingsUrl: 'https://app.linkup.golf/more/settings',
    unsubscribeUrl: 'https://app.linkup.golf/api/email/unsubscribe?t=abc.def',
    ...over,
  })

  it('offers a way out in both parts of the message', () => {
    const { html, text } = renderNotificationEmail(base())
    expect(html).toContain('>Unsubscribe</a>')
    expect(html).toContain('https://app.linkup.golf/api/email/unsubscribe?t=abc.def')
    expect(text).toContain('Unsubscribe: https://app.linkup.golf/api/email/unsubscribe?t=abc.def')
  })

  it('says nothing about unsubscribing when there is no link to offer', () => {
    // A dead "Unsubscribe" link is worse than none: it looks like a way out.
    const { html, text } = renderNotificationEmail(base({ unsubscribeUrl: '' }))
    expect(html).not.toContain('Unsubscribe')
    expect(text).not.toContain('Unsubscribe')
  })

  it('never renders an unusable link as one', () => {
    const { html } = renderNotificationEmail(base({ unsubscribeUrl: 'javascript:alert(1)' }))
    expect(html).not.toContain('Unsubscribe')
    expect(html).not.toContain('javascript:')
  })
})

// ---- Resend's side of the conversation ----------------------

const SECRET = 'whsec_' + Buffer.from('a-signing-secret-of-some-length').toString('base64')

function signed(body: string, opts: { id?: string; at?: number; secret?: string } = {}) {
  const id = opts.id ?? 'msg_2abc'
  const at = opts.at ?? Math.floor(Date.now() / 1000)
  const key = Buffer.from((opts.secret ?? SECRET).replace(/^whsec_/, ''), 'base64')
  const sig = createHmac('sha256', key).update(`${id}.${at}.${body}`).digest('base64')
  return { headers: { id, timestamp: String(at), signature: `v1,${sig}` }, body }
}

describe('verifySvixSignature', () => {
  const body = JSON.stringify({ type: 'email.bounced' })

  it('accepts a delivery Resend signed', () => {
    const { headers } = signed(body)
    expect(verifySvixSignature({ headers, body, secret: SECRET })).toEqual({ ok: true })
  })

  it('refuses one signed with a different secret', () => {
    const other = 'whsec_' + Buffer.from('not-the-same-secret-at-all').toString('base64')
    const { headers } = signed(body, { secret: other })
    expect(verifySvixSignature({ headers, body, secret: SECRET })).toEqual({
      ok: false,
      reason: 'no-match',
    })
  })

  it('refuses a body that changed after it was signed', () => {
    const { headers } = signed(body)
    const tampered = JSON.stringify({ type: 'email.complained' })
    expect(verifySvixSignature({ headers, body: tampered, secret: SECRET }).ok).toBe(false)
  })

  it('accepts the new secret while an old one is still being offered', () => {
    // A rotation puts two signatures in the header; either matching is enough.
    const old = 'whsec_' + Buffer.from('the-previous-signing-secret').toString('base64')
    const a = signed(body, { secret: old })
    const b = signed(body, { id: a.headers.id, at: Number(a.headers.timestamp) })
    const headers = { ...a.headers, signature: `${a.headers.signature} ${b.headers.signature}` }
    expect(verifySvixSignature({ headers, body, secret: SECRET })).toEqual({ ok: true })
  })

  it('refuses a delivery old enough to be a replay', () => {
    const at = Math.floor(Date.now() / 1000) - SVIX_TOLERANCE_SECONDS - 1
    const { headers } = signed(body, { at })
    expect(verifySvixSignature({ headers, body, secret: SECRET })).toEqual({
      ok: false,
      reason: 'stale-timestamp',
    })
  })

  it('refuses everything when no secret is configured', () => {
    // A webhook that writes to the suppression list must never be open.
    const { headers } = signed(body)
    expect(verifySvixSignature({ headers, body, secret: undefined })).toEqual({
      ok: false,
      reason: 'no-secret',
    })
    expect(verifySvixSignature({ headers, body, secret: '  ' }).ok).toBe(false)
  })

  it('refuses a delivery missing any of the three headers', () => {
    const { headers } = signed(body)
    for (const key of ['id', 'timestamp', 'signature'] as const) {
      const partial = { ...headers, [key]: null }
      expect(verifySvixSignature({ headers: partial, body, secret: SECRET })).toEqual({
        ok: false,
        reason: 'missing-headers',
      })
    }
  })

  it('refuses a timestamp that is not a number', () => {
    const { headers } = signed(body)
    expect(
      verifySvixSignature({ headers: { ...headers, timestamp: 'soon' }, body, secret: SECRET }),
    ).toEqual({ ok: false, reason: 'bad-timestamp' })
  })
})

describe('reading a bounce', () => {
  it('only suppresses on a permanent bounce', () => {
    expect(isHardBounce('Permanent')).toBe(true)
    expect(isHardBounce('permanent')).toBe(true)
    // A full mailbox is not a dead address, and suppressing on one would drop a
    // live member out of every future notification.
    expect(isHardBounce('Transient')).toBe(false)
    expect(isHardBounce('Undetermined')).toBe(false)
    expect(isHardBounce(null)).toBe(false)
    expect(isHardBounce(undefined)).toBe(false)
  })

  it('reads the recipients however the payload spells them', () => {
    expect(eventAddresses({ data: { to: ['a@b.com', 'c@d.com'] } })).toEqual(['a@b.com', 'c@d.com'])
    expect(eventAddresses({ data: { to: 'a@b.com' } })).toEqual(['a@b.com'])
    expect(eventAddresses({ data: {} })).toEqual([])
    expect(eventAddresses({})).toEqual([])
  })
})

describe('normaliseAddress', () => {
  it('reduces an address to the one spelling we store and compare', () => {
    // A webhook reports what the receiving server said; the members row holds
    // whatever was typed. They have to compare equal.
    expect(normaliseAddress('  Dana@Example.COM ')).toBe('dana@example.com')
  })

  it('drops anything that is not an address', () => {
    for (const bad of ['', '   ', 'dana', null, undefined]) {
      expect(normaliseAddress(bad)).toBe('')
    }
  })

  it('names exactly the reasons the table allows', () => {
    expect([...SUPPRESSION_REASONS]).toEqual(['bounced', 'complained', 'unsubscribed'])
  })
})
