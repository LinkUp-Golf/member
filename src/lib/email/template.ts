// The one email LinkUp sends.
//
// Every notification uses this layout — logo, a white card on a tinted page, a
// heading, a line of explanation, an optional image, and one button that opens
// the app at the place the notification is about. A notification that needed
// its own design would be a notification that should have been a page.
//
// Written as a string rather than with a component library on purpose. Email
// clients are a decade behind browsers: Outlook renders through Word, Gmail
// strips <style> from the <head> on some clients, and flexbox and modern CSS
// units are unreliable everywhere. So this is table-based, inline-styled, and
// uses only properties that have worked since 2010. Keeping it dependency-free
// also keeps it testable — renderNotificationEmail is pure.
//
// Pairs with ./send, which resolves who gets it, and with the push templates in
// src/lib/push.ts, which supply the heading, body and destination unchanged:
// one notification, described once, delivered two ways.

/** LinkUp brand, as literal hex — email clients have no CSS variables. */
const NAVY = '#002669'
const NAVY_DEEP = '#001040'
const GREEN = '#85bb65'
const CHARCOAL = '#333132'
const PAGE_BG = '#EEEEF5'
const CARD_BG = '#FFFFFF'
const MUTED = '#6B7280'
const BORDER = '#DDE5F5'

export interface NotificationEmail {
  /** The card's headline — the push notification's title. */
  heading: string
  /** The sentence under it — the push notification's body. */
  body: string
  /** Absolute https URL the button opens. */
  ctaUrl: string
  /** Words on the button. */
  ctaLabel: string
  /** Absolute https URL of the logo above the card. */
  logoUrl: string
  /** Optional hero image inside the card, above the button. */
  imageUrl?: string | null
  /** Shown in the client's inbox preview line, before the body is opened. */
  preheader?: string
  /** Where "notification settings" in the footer points. */
  settingsUrl: string
}

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

/**
 * HTML-escapes a value going into the markup.
 *
 * Every field here is app-supplied rather than typed by a member, but a member's
 * name reaches these templates ("Dana sent you a message") and a name with an
 * apostrophe or an angle bracket must not be able to alter the document. The
 * push service sanitises by deleting those characters; an email can show them
 * properly, so this escapes rather than strips.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Only http(s) URLs reach an href.
 *
 * A destination is built from a notification's own relative path, so this is
 * defence rather than a live threat — but an href is the one place in this
 * document where a javascript: or data: value would be more than text.
 */
export function safeUrl(value: string): string {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '#'
    return url.toString()
  } catch {
    return '#'
  }
}

/**
 * The invisible line email clients show beside the subject in an inbox list.
 *
 * Padded with zero-width characters, which is the long-standing trick: without
 * them the client fills the rest of the preview with whatever text comes first
 * in the document — here, the words "View in browser" or the logo's alt text.
 */
function preheaderBlock(text: string): string {
  return `
    <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${PAGE_BG};">
      ${escapeHtml(text)}${'&#8199;&#65279;&#847; '.repeat(60)}
    </div>`
}

/** The whole email, ready to send. */
export function renderNotificationEmail(email: NotificationEmail): RenderedEmail {
  const heading = escapeHtml(email.heading)
  const body = escapeHtml(email.body)
  const ctaLabel = escapeHtml(email.ctaLabel)
  const ctaUrl = safeUrl(email.ctaUrl)
  const logoUrl = safeUrl(email.logoUrl)
  const settingsUrl = safeUrl(email.settingsUrl)
  const imageUrl = email.imageUrl ? safeUrl(email.imageUrl) : null

  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
${email.preheader ? preheaderBlock(email.preheader) : ''}
  <!-- Full-bleed page background. A body background alone is ignored by
       Outlook, so the outer table carries it too. -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BG};">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding:0 0 24px 0;">
              <a href="${ctaUrl}" style="text-decoration:none;">
                <!-- public/logos/logo-full-color.png, which is square. Both
                     dimensions are stated because Outlook renders through Word
                     and ignores height:auto, collapsing the mark to a sliver;
                     a fixed height is only safe because the asset's aspect
                     ratio is fixed too. -->
                <img src="${logoUrl}" alt="LinkUp Golf" width="120" height="120" style="display:block;border:0;outline:none;text-decoration:none;width:120px;max-width:120px;height:120px;" />
              </a>
            </td>
          </tr>

          <!-- The card -->
          <tr>
            <td style="background-color:${CARD_BG};border-radius:16px;padding:32px 28px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

                <tr>
                  <td align="center" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:22px;line-height:30px;font-weight:700;color:${NAVY_DEEP};padding:0 0 12px 0;">
                    ${heading}
                  </td>
                </tr>

                <tr>
                  <td align="center" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:22px;color:${MUTED};padding:0 0 24px 0;">
                    ${body}
                  </td>
                </tr>
${
  imageUrl
    ? `
                <tr>
                  <td align="center" style="padding:0 0 24px 0;">
                    <img src="${imageUrl}" alt="" width="424" style="display:block;border:0;outline:none;text-decoration:none;width:100%;max-width:424px;height:auto;border-radius:10px;" />
                  </td>
                </tr>`
    : ''
}
                <!-- The button. A bordered table cell rather than a styled
                     <a>, because Outlook drops padding and background-color
                     from an anchor and would render the label as bare text. -->
                <tr>
                  <td align="center">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" bgcolor="${NAVY}" style="background-color:${NAVY};border-radius:999px;">
                          <a href="${ctaUrl}" target="_blank" rel="noopener noreferrer"
                             style="display:inline-block;padding:13px 30px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:14px;line-height:18px;font-weight:700;color:#FFFFFF;text-decoration:none;border-radius:999px;">
                            ${ctaLabel}
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <!-- The same destination as plain text. A button that doesn't
                     render, or a client that blocks it, must not leave the
                     reader with no way through. -->
                <tr>
                  <td align="center" style="font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;line-height:18px;color:${MUTED};padding:18px 0 0 0;word-break:break-all;">
                    Or paste this into your browser:<br />
                    <a href="${ctaUrl}" style="color:${NAVY};text-decoration:underline;">${escapeHtml(ctaUrl)}</a>
                  </td>
                </tr>

              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:24px 12px 0 12px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-size:11px;line-height:18px;color:${MUTED};">
              You're receiving this because you're a LinkUp Golf member.<br />
              <a href="${settingsUrl}" style="color:${NAVY};text-decoration:underline;">Notification settings</a>
              <span style="color:${BORDER};">&nbsp;|&nbsp;</span>
              <span style="color:${CHARCOAL};">LinkUp Golf</span>
            </td>
          </tr>

          <!-- A sliver of the accent, so the mark at the top and the tail of
               the email belong to the same brand. -->
          <tr>
            <td align="center" style="padding:16px 0 0 0;">
              <div style="width:28px;height:3px;border-radius:2px;background-color:${GREEN};font-size:0;line-height:0;">&nbsp;</div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

  // Sent alongside the HTML. A text part is what a client with images and
  // markup off falls back to, and its absence is itself a spam signal.
  const text = [
    email.heading,
    '',
    email.body,
    '',
    `${email.ctaLabel}: ${ctaUrl}`,
    '',
    "You're receiving this because you're a LinkUp Golf member.",
    `Notification settings: ${settingsUrl}`,
  ].join('\n')

  return { subject: email.heading, html, text }
}
