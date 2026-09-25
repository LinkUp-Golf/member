// Which notifications may be emailed, how often, and why.
//
// Every notification in NotificationTemplates now has an email counterpart, so
// the question is no longer *whether* a notification can be emailed but how
// much of a member's inbox it's allowed to take. Push gets away with volume
// because a notification that isn't tapped disappears; an email that isn't
// read sits there, and twenty of them is how a sender gets filtered.
//
// So the restraint that used to live in the choice of call site — sendPush*
// here, notify* there — lives here instead, as a policy you can read in one
// sitting and audit against the templates it governs.
//
// Two dials, and they do different jobs:
//
//   cooldown  stops one kind of notification repeating. Four members join your
//             course this week: four pushes, one email.
//   daily cap stops every kind arriving at once. It counts transactional mail
//             too — those are never suppressed, but a day full of them is a
//             day that shouldn't also carry chatter.
//
// This module is pure. The counts come from email_send_log (see ./throttle).

/**
 * What a notification is for, which is what decides how it's rationed.
 *
 * - `transactional` — it concerns this member's money, access or commitments:
 *   a payment due, an application answered, a round cancelled, credit issued.
 *   Never suppressed. Missing one of these is worse than any amount of mail.
 * - `conversation` — someone wrote to them. Bursty by nature, so the rationing
 *   is done upstream by src/lib/messages/email-policy.ts, which emails the
 *   message that breaks a silence and stays quiet for the rest of the thread.
 * - `community` — worth knowing, not worth interrupting for: a new member, an
 *   announcement, an offer, someone else's tee time. Cooled down per kind and
 *   capped overall.
 */
export type EmailCategory = 'transactional' | 'conversation' | 'community'

export interface CategoryRules {
  /** Milliseconds before the same notification kind may be emailed again. */
  cooldownMs: number
  /** Whether the daily cap can suppress this category. */
  capped: boolean
}

const HOURS = 60 * 60 * 1000

export const CATEGORY_RULES: Record<EmailCategory, CategoryRules> = {
  transactional: { cooldownMs: 0, capped: false },
  conversation: { cooldownMs: 0, capped: true },
  community: { cooldownMs: 20 * HOURS, capped: true },
}

/**
 * The most email one member can receive in a rolling day.
 *
 * Eight is deliberately generous: it should never be reached by a member
 * living a normal week, and should stop a runaway — a course-wide broadcast
 * loop, a bulk import firing a notification per row — from emptying our
 * sending reputation into everyone's spam folder before anyone notices.
 */
export const DAILY_EMAIL_CAP = 8

/** The rolling window the cap is measured over. */
export const CAP_WINDOW_MS = 24 * HOURS

/**
 * Notification kind → category, matched against a payload's `tag`.
 *
 * Tags are already how the push service types a notification (TAG_TYPE_MAP in
 * push/pushService.ts), and several are built with a suffix — `msg-<id>`,
 * `booking-<date>` — so matching is by prefix. Longest prefix wins, which is
 * what keeps `booking-invite` (a commitment) apart from `booking-2026-09-27`
 * (someone else's tee time).
 *
 * Anything unlisted is treated as `community`: a new notification is rationed
 * until someone decides otherwise, rather than going straight to everyone.
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

  // ---- Worth knowing, not worth interrupting --------------------
  // 'hosted-event-joined' is the host's "someone reserved a spot". A popular
  // round fills four at a time, and the host is not waiting on each one.
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
 * This is what the cooldown counts against, so it has to be the *kind* of
 * notification rather than the instance. `msg-<conversation>` must collapse to
 * `msg`, or every conversation would have its own budget.
 */
export function notificationKey(tag?: string): string {
  if (!tag) return 'general'
  for (const key of ORDERED_TAGS) {
    if (tag === key || tag.startsWith(`${key}-`)) return key
  }
  return tag
}

/** How a notification is rationed. Unknown kinds are rationed, not waved through. */
export function categoryFor(tag?: string): EmailCategory {
  return CATEGORY_BY_TAG[notificationKey(tag)] ?? 'community'
}

export interface ThrottleState {
  /** When this kind was last emailed to this member, ISO, or null for never. */
  lastSentAt: string | null
  /** How many emails of any kind this member had in the cap window. */
  sentInWindow: number
}

export interface ThrottleDecision {
  send: boolean
  /** Why, for the log — the only way to answer "why no email?" after the fact. */
  reason: 'ok' | 'cooldown' | 'daily_cap'
}

/**
 * Whether this member may be emailed this notification now.
 *
 * Errs towards sending: a decision made on a failed lookup should cost a
 * duplicate at worst, never a silence. The caller supplies a zeroed state when
 * it can't read the log.
 */
export function throttleDecision(
  category: EmailCategory,
  state: ThrottleState,
  now: number = Date.now(),
): ThrottleDecision {
  const rules = CATEGORY_RULES[category]

  if (rules.capped && state.sentInWindow >= DAILY_EMAIL_CAP) {
    return { send: false, reason: 'daily_cap' }
  }

  if (rules.cooldownMs > 0 && state.lastSentAt) {
    const last = Date.parse(state.lastSentAt)
    if (!Number.isNaN(last) && now - last < rules.cooldownMs) {
      return { send: false, reason: 'cooldown' }
    }
  }

  return { send: true, reason: 'ok' }
}
