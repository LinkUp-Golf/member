import { describe, it, expect } from 'vitest'
import {
  escapeHtml,
  renderNotificationEmail,
  safeUrl,
  type NotificationEmail,
} from '@/lib/email/template'
import { absoluteUrl } from '@/lib/email/send'
import { maskEmail } from '@/lib/email/client'

// An email can't be fixed after it's sent, and nobody sees it before a member
// does. These lock the parts that would be silently wrong: the destination the
// button opens, and what happens to a member's name on the way into markup.

const base = (over: Partial<NotificationEmail> = {}): NotificationEmail => ({
  heading: 'Your round is confirmed',
  body: 'Aviara on Saturday at 1:30pm.',
  ctaUrl: 'https://app.linkup.golf/book',
  ctaLabel: 'Pay for your round',
  logoUrl: 'https://app.linkup.golf/logos/logo-full-color.png',
  settingsUrl: 'https://app.linkup.golf/more/settings',
  ...over,
})

describe('renderNotificationEmail', () => {
  it('puts the destination on the button and again as readable text', () => {
    const { html } = renderNotificationEmail(base())
    // Twice: the button, and the paste-this-in fallback for a client that
    // won't render it.
    expect(html.split('https://app.linkup.golf/book').length - 1).toBeGreaterThanOrEqual(2)
    expect(html).toContain('Pay for your round')
  })

  it('subjects the email with its heading', () => {
    expect(renderNotificationEmail(base()).subject).toBe('Your round is confirmed')
  })

  it('sends a plain-text part carrying the same link', () => {
    // Its absence is a spam signal, and it's the fallback when images and
    // markup are off.
    const { text } = renderNotificationEmail(base())
    expect(text).toContain('Your round is confirmed')
    expect(text).toContain('https://app.linkup.golf/book')
  })

  it('includes the hero image only when there is one', () => {
    expect(renderNotificationEmail(base()).html).not.toContain('<img src="https://cdn')
    const withImage = renderNotificationEmail(
      base({ imageUrl: 'https://cdn.example.com/round.jpg' }),
    )
    expect(withImage.html).toContain('https://cdn.example.com/round.jpg')
  })

  it('escapes a name rather than letting it close a tag', () => {
    const { html } = renderNotificationEmail(
      base({ heading: '<script>alert(1)</script> & "Dana"' }),
    )
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('refuses a destination that is not http(s)', () => {
    const { html } = renderNotificationEmail(
      base({ ctaUrl: 'javascript:alert(1)' }),
    )
    expect(html).not.toContain('javascript:')
  })
})

describe('escapeHtml', () => {
  it('escapes rather than strips, so a name still reads as itself', () => {
    // The push service deletes these characters because a notification renders
    // as plain text; an email can show O'Neill properly.
    expect(escapeHtml("O'Neill & Sons")).toBe('O&#39;Neill &amp; Sons')
  })
})

describe('safeUrl', () => {
  it('passes http and https through', () => {
    expect(safeUrl('https://app.linkup.golf/book')).toBe('https://app.linkup.golf/book')
  })

  it('refuses every other scheme, and anything unparseable', () => {
    expect(safeUrl('javascript:alert(1)')).toBe('#')
    expect(safeUrl('data:text/html,<script>')).toBe('#')
    expect(safeUrl('/book')).toBe('#')
  })
})

describe('absoluteUrl', () => {
  it('resolves the relative path a push notification carries', () => {
    // Push hands the service worker '/members/123'; an email client has no
    // origin to resolve that against.
    expect(absoluteUrl('/members/123')).toMatch(/^https?:\/\/.+\/members\/123$/)
  })

  it('leaves an already-absolute URL alone', () => {
    expect(absoluteUrl('https://elsewhere.test/x')).toBe('https://elsewhere.test/x')
  })

  it('falls back to the app root when a notification names no destination', () => {
    expect(absoluteUrl(undefined)).toMatch(/^https?:\/\/[^/]+\/$/)
  })
})

describe('maskEmail', () => {
  it('keeps a log line traceable without putting an address in it', () => {
    // Two characters and the domain is enough to match a row you already have
    // open, and not enough to be a contact list in a log aggregator.
    expect(maskEmail('dana.mcbride@gmail.com')).toBe('da****@gmail.com')
    expect(maskEmail('sam@linkup.golf')).toBe('sa*@linkup.golf')
  })

  it('never echoes a short local part whole', () => {
    expect(maskEmail('jo@x.com')).toBe('j*@x.com')
    expect(maskEmail('a@x.com')).toBe('a*@x.com')
  })

  it('gives up rather than guess at something that is not an address', () => {
    expect(maskEmail('not-an-address')).toBe('***')
    expect(maskEmail('@x.com')).toBe('***')
  })
})
