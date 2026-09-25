// The one email LinkUp sends.
//
// Every notification uses this layout: a small wordmark, a white card on the
// app's cream, a heading, a line of explanation, an optional image, and one
// button that opens the app where the notification points. A notification
// that needed its own design would be one that should have been a page.
//
// Deliberately restrained. This is correspondence about something that has
// already happened to the reader — a round booked, an application answered —
// not an advert for it. So: left-aligned rather than centred, a hairline
// rather than a shadow, the app's own navy and type, and exactly one piece of
// decoration — a strip of grass green along the top of the card.
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

/**
 * LinkUp brand, as literal hex — email clients have no CSS variables.
 * Values mirror tailwind.config.ts so the email and the app are the same
 * product: green-900 is the brand navy despite the name, gold is the grass
 * green accent.
 */
const NAVY = '#002669'        // green-900 — primary
const NAVY_DEEP = '#001040'   // green-950 — headings
const GRASS = '#85bb65'       // gold.DEFAULT — the one accent
const BODY_TEXT = '#555355'   // charcoal.light
const PAGE_BG = '#F8F8FC'     // cream
const CARD_BG = '#FFFFFF'
const HAIRLINE = '#DDE5F5'    // green-100
const MUTED = '#8A8894'

/**
 * Lexend Deca is the app's typeface, requested for the few clients that honour
 * a webfont (Apple Mail, iOS) and falling back to the system stack everywhere
 * else. The fallback is the point: an email that depends on a font download is
 * an email that renders wrong more often than not.
 */
const FONT = "'Lexend Deca',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif"

export interface NotificationEmail {
  /** The card's headline — the push notification's title. */
  heading: string
  /**
   * The subject line. Read in an inbox with nothing around it, so it carries
   * context the heading doesn't have to; defaults to the heading when a
   * notification doesn't give one.
   */
  subject?: string
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
  <link href="https://fonts.googleapis.com/css2?family=Lexend+Deca:wght@400;500;600&display=swap" rel="stylesheet" />
</head>
<body style="margin:0;padding:0;background-color:${PAGE_BG};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
${email.preheader ? preheaderBlock(email.preheader) : ''}
  <!-- Full-bleed page background. A body background alone is ignored by
       Outlook, so the outer table carries it too. -->
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAGE_BG};">
    <tr>
      <td align="center" style="padding:40px 16px;">

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;width:100%;">

          <!-- The mark, centred above the card. Both dimensions are stated
               because Outlook renders through Word and ignores height:auto,
               collapsing it to a sliver; a fixed height is only safe because
               the asset is square. -->
          <tr>
            <td align="center" style="padding:0 0 24px 0;">
              <a href="${ctaUrl}" style="text-decoration:none;">
                <img src="${logoUrl}" alt="LinkUp Golf" width="120" height="120" style="display:block;border:0;outline:none;text-decoration:none;width:120px;max-width:120px;height:120px;border-radius:26px;" />
              </a>
            </td>
          </tr>

          <!-- The card. A hairline rather than a shadow, because most clients
               drop box-shadow and a borderless white block on a near-white
               page has no edge at all. -->
          <tr>
            <td style="background-color:${CARD_BG};border:1px solid ${HAIRLINE};border-radius:14px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

                <!-- The single piece of decoration in the whole email: a strip
                     of the accent green along the top edge. One gesture toward
                     the course, no clip-art. -->
                <tr>
                  <td style="background-color:${GRASS};font-size:0;line-height:0;border-radius:13px 13px 0 0;">&nbsp;</td>
                </tr>

                <tr>
                  <td style="padding:28px 26px 30px 26px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">

                      <!-- Left-aligned throughout. Centred text is for
                           marketing; this is a notification about something
                           that already happened. -->
                      <tr>
                        <td align="left" style="font-family:${FONT};font-size:19px;line-height:27px;font-weight:600;letter-spacing:-0.2px;color:${NAVY_DEEP};padding:0 0 10px 0;">
                          ${heading}
                        </td>
                      </tr>

                      <tr>
                        <td align="left" style="font-family:${FONT};font-size:15px;line-height:24px;color:${BODY_TEXT};padding:0 0 24px 0;">
                          ${body}
                        </td>
                      </tr>
${
  imageUrl
    ? `
                      <tr>
                        <td align="left" style="padding:0 0 24px 0;">
                          <img src="${imageUrl}" alt="" width="428" style="display:block;border:0;outline:none;text-decoration:none;width:100%;max-width:428px;height:auto;border-radius:10px;" />
                        </td>
                      </tr>`
    : ''
}
                      <!-- The button. A bordered table cell rather than a
                           styled <a>, because Outlook drops padding and
                           background-color from an anchor and would render the
                           label as bare text. 12px radius matches the app's
                           own primary buttons. -->
                      <tr>
                        <td align="center">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                            <tr>
                              <td align="center" bgcolor="${NAVY}" style="background-color:${NAVY};border-radius:12px;">
                                <a href="${ctaUrl}" target="_blank" rel="noopener noreferrer"
                                   style="display:inline-block;padding:12px 24px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:12px;">
                                  ${ctaLabel}
                                </a>
                              </td>
                            </tr>
                          </table>
                        </td>
                      </tr>

                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="left" style="padding:20px 2px 0 2px;font-family:${FONT};font-size:12px;line-height:20px;color:${MUTED};">
              You're receiving this because you're a member.
              <a href="${settingsUrl}" style="color:${NAVY};text-decoration:underline;">Notification settings</a>
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

  return { subject: email.subject?.trim() || email.heading, html, text }
}
