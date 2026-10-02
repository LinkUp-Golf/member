import { describe, it, expect } from 'vitest'
import {
  escapeHtml,
  renderNotificationEmail,
  safeUrl,
  type NotificationEmail,
} from '@/lib/email/template'
import { absoluteUrl, assetUrl } from '@/lib/email/send'
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
  unsubscribeUrl: 'https://app.linkup.golf/api/email/unsubscribe?t=abc.def',
  ...over,
})

describe('renderNotificationEmail', () => {
  it('puts the destination on the button, and on the logo above it', () => {
    const { html } = renderNotificationEmail(base())
    expect(html.split('https://app.linkup.golf/book').length - 1).toBeGreaterThanOrEqual(2)
    expect(html).toContain('Pay for your round')
  })

  it('does not repeat the URL as text under the button', () => {
    // It was there as a fallback for clients that won't render the button, and
    // it made every email end in a wall of raw URL.
    const { html } = renderNotificationEmail(base())
    expect(html).not.toContain('paste this into your browser')
  })

  it('uses the notification\'s own subject line', () => {
    expect(
      renderNotificationEmail(base({ subject: 'Dana added you to a tee time' })).subject,
    ).toBe('Dana added you to a tee time')
  })

  it('falls back to the heading when a notification gives no subject', () => {
    expect(renderNotificationEmail(base()).subject).toBe('Your round is confirmed')
  })

  it('treats a blank subject as none at all', () => {
    expect(renderNotificationEmail(base({ subject: '   ' })).subject).toBe(
      'Your round is confirmed',
    )
  })

  it('sends a plain-text part carrying the same link', () => {
    // Its absence is a spam signal, and it's the fallback when images and
    // markup are off.
    const { text } = renderNotificationEmail(base())
    expect(text).toContain('Your round is confirmed')
    expect(text).toContain('https://app.linkup.golf/book')
  })

  it('includes an image only when there is one', () => {
    expect(renderNotificationEmail(base()).html).not.toContain('<img src="https://cdn')
    const withImage = renderNotificationEmail(
      base({ imageUrls: ['https://cdn.example.com/round.jpg'] }),
    )
    expect(withImage.html).toContain('https://cdn.example.com/round.jpg')
  })

  it('shows the first photo a post carries and counts the rest', () => {
    // Four photos used to email as four photos: a scroll, and three downloads
    // the reader paid for to reach a button below all of them. One photo says
    // what the post is about and the count says there is more.
    const { html } = renderNotificationEmail(
      base({
        imageUrls: [
          'https://cdn.example.com/one.jpg',
          'https://cdn.example.com/two.jpg',
          'https://cdn.example.com/three.jpg',
        ],
      }),
    )
    expect(html).toContain('one.jpg')
    expect(html).not.toContain('two.jpg')
    expect(html).not.toContain('three.jpg')
    expect(html.match(/<img src="https:\/\/cdn/g)).toHaveLength(1)
    expect(html).toContain('+2 more photos')
  })

  it('counts one extra photo in the singular', () => {
    const { html } = renderNotificationEmail(
      base({
        imageUrls: ['https://cdn.example.com/one.jpg', 'https://cdn.example.com/two.jpg'],
      }),
    )
    expect(html).toContain('+1 more photo')
    expect(html).not.toContain('+1 more photos')
  })

  it('says nothing about more photos when there is only the one', () => {
    const { html } = renderNotificationEmail(
      base({ imageUrls: ['https://cdn.example.com/one.jpg'] }),
    )
    expect(html).not.toContain('more photo')
  })

  it('opens the post from the photo as well as the button', () => {
    // The rest of the photos are in the app, so the thing standing in for them
    // has to be the way there.
    const { html } = renderNotificationEmail(
      base({
        imageUrls: ['https://cdn.example.com/one.jpg', 'https://cdn.example.com/two.jpg'],
      }),
    )
    // The strip and the image are each wrapped in the destination link, on top
    // of the logo and the button.
    expect(html.split('https://app.linkup.golf/book').length - 1).toBeGreaterThanOrEqual(4)
  })

  it('counts only the photos it can actually use', () => {
    // An unusable URL is dropped, and a "+2" standing for two broken images
    // would promise the member something the post hasn't got.
    const { html } = renderNotificationEmail(
      base({
        imageUrls: [
          'https://cdn.example.com/one.jpg',
          'javascript:alert(1)',
          null,
          'https://cdn.example.com/two.jpg',
        ],
      }),
    )
    expect(html).toContain('+1 more photo')
    expect(html).not.toContain('+3 more')
  })

  it('drops an image it cannot use rather than rendering a broken one', () => {
    // safeUrl answers '#' for anything unusable, which as an <img> source is a
    // broken image in the middle of the card.
    const { html } = renderNotificationEmail(
      base({
        imageUrls: [
          'javascript:alert(1)',
          '',
          null,
          'https://cdn.example.com/real.jpg',
        ],
      }),
    )
    expect(html).toContain('real.jpg')
    expect(html).not.toContain('javascript:')
    expect(html.match(/<img src="https:\/\/cdn/g)).toHaveLength(1)
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

describe('assetUrl', () => {
  it('never points an email image at a machine the recipient cannot reach', () => {
    // Gmail fetches images through its own proxy and a phone fetches them over
    // the network; localhost is neither, so a dev-sent email would arrive with
    // a broken logo.
    const prev = process.env.NEXT_PUBLIC_APP_URL
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
    expect(assetUrl('/logos/logo-full-color.png')).toBe(
      'https://app.linkup.golf/logos/logo-full-color.png',
    )
    process.env.NEXT_PUBLIC_APP_URL = prev
  })

  it('uses the configured app when it is a real one', () => {
    const prev = process.env.NEXT_PUBLIC_APP_URL
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.linkup.golf'
    expect(assetUrl('/logos/logo-full-color.png')).toBe(
      'https://staging.linkup.golf/logos/logo-full-color.png',
    )
    process.env.NEXT_PUBLIC_APP_URL = prev
  })
})
