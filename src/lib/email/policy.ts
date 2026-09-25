// What kind of notification an email is.
//
// Every notification in NotificationTemplates has an email counterpart, and
// none of them are suppressed: if it was worth a push, it is sent as an email
// too, however many that turns out to be. There is deliberately no cooldown
// and no daily cap — a member would rather have five emails than miss the one
// that mattered.
//
// What remains here is classification. It doesn't gate anything; it's the
// label recorded against each send in email_send_log, which is how you answer
// "what have we been sending this member, and how much of it?" after the fact.
// If volume ever needs limiting again, this is where the rule would go and
// the log already holds the history to base it on.

/**
 * What a notification is for.
 *
 * - `transactional` — this member's money, access or commitments: a payment
 *   due, an application answered, a round cancelled, credit issued.
 * - `conversation` — someone wrote to them. Which messages earn an email is
 *   decided upstream by src/lib/messages/email-policy.ts, on whether the
 *   recipient had already been told, not on volume.
 * - `community` — worth knowing: a new member, an announcement, an offer,
 *   someone else's tee time.
 */
export type EmailCategory = 'transactional' | 'conversation' | 'community'

/**
 * Notification kind → category, matched against a payload's `tag`.
 *
 * Tags are already how the push service types a notification (TAG_TYPE_MAP in
 * push/pushService.ts), and several are built with a suffix — `msg-<id>`,
 * `booking-<date>` — so matching is by prefix. Longest prefix wins, which is
 * what keeps `booking-invite` (a commitment) apart from `booking-2026-09-27`
 * (someone else's tee time).
 */
export const CATEGORY_BY_TAG: Record<string, EmailCategory> = {
  // ---- Money, access, commitments -------------------------------
  'payment-ready': 'transactional',
  'booking-invite': 'transactional',
  'booking-reminder': 'transactional',
  'booking-cancelled': 'transactional',
  'dinner-rsvp': 'transactional',
  'guest-access': 'transactional',
  'member-activated': 'transactional',
  'member-event-rejected': 'transactional',

  'referral-partner-approved': 'transactional',
  'referral-partner-rejected': 'transactional',
  'referral-list-imported': 'transactional',
  'referral-list-rejected': 'transactional',
  'referral-commission-paid': 'transactional',
  'referral-joined': 'transactional',

  'host-application-approved': 'transactional',
  'host-application-rejected': 'transactional',
  'hosted-event-created': 'transactional',
  'hosted-event-review': 'transactional',
  'hosted-event-approved': 'transactional',
  'hosted-event-rejected': 'transactional',
  'hosted-event-cancelled': 'transactional',
  'hosted-event-updated': 'transactional',
  'hosted-event-dates-held': 'transactional',
  'hosted-event-proof': 'transactional',
  'venue-approved': 'transactional',
  'host-credit-approved': 'transactional',
  'host-credit-rejected': 'transactional',
  'host-credit-redeemed': 'transactional',
  'host-credit-coupon': 'transactional',
  'host-credit-redemption': 'transactional',

  // ---- Someone wrote to them ------------------------------------
  'msg': 'conversation',
  'group-invite': 'conversation',

  // ---- Community ------------------------------------------------
  'hosted-event-joined': 'community',
  'new-member': 'community',
  'booking': 'community',
  'visit': 'community',
  'focus-linkup': 'community',
  'suggestion': 'community',
  'announcement': 'community',
  'promotion': 'community',
  'booking-survey': 'community',
  'test-notification': 'community',
}

// Longest first, so a specific tag is never shadowed by a shorter one that
// happens to prefix it.
const ORDERED_TAGS = Object.keys(CATEGORY_BY_TAG).sort((a, b) => b.length - a.length)

/**
 * The policy key for a notification — the tag with its dynamic suffix removed.
 *
 * This is what a send is logged against, so it has to be the *kind* of
 * notification rather than the instance: `msg-<conversation>` collapses to
 * `msg`, or the log would be one row per conversation and tell you nothing.
 */
export function notificationKey(tag?: string): string {
  if (!tag) return 'general'
  for (const key of ORDERED_TAGS) {
    if (tag === key || tag.startsWith(`${key}-`)) return key
  }
  return tag
}

/** How a notification is classified. Unknown kinds are recorded as community. */
export function categoryFor(tag?: string): EmailCategory {
  return CATEGORY_BY_TAG[notificationKey(tag)] ?? 'community'
}
