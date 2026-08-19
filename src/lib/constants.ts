// ============================================================
// App-wide constants
// Business logic values, IDs, and configuration that are used
// across multiple files. Environment-specific secrets stay in
// .env.local; these are stable values that live in code.
// ============================================================

import type { PayoutMethod } from '@/types'

// ---- Landing ------------------------------------------------

// Where a signed-in member lands whenever nothing more specific applies:
// after login, on the bare origin, when bounced out of a workspace they
// can't access, and as the installed PWA's start_url (public/manifest.json
// hard-codes the same path — keep the two in step).
//
// Deliberately fixed rather than "wherever you were": the app used to send
// you back to the page your session expired on, so a member whose session
// died in Settings signed back in to Settings.
export const DEFAULT_LANDING_PATH = '/book'

// ---- GHL API ------------------------------------------------

export const GHL_BASE_URL = 'https://services.leadconnectorhq.com'
export const GHL_API_VERSION = '2021-07-28'
export const GHL_OPPORTUNITY_SOURCE = 'Focus LinkUps'
export const GHL_DEFAULT_ASSIGNEE_ID = 'D21Ek6JOVnWiySyrRw0U'

// Custom field IDs on the Avi-Play opportunity object
export const GHL_OPPORTUNITY_FIELDS = {
  EVENT_DATETIME: '7LVP60vMewxMbN7GGrEw',
  BOOKING_STATUS:  'cpkkAiYfAWClcpFZBM9A',
  LOCATION:        'k2BbZ9xILzaomRJwvVv8',
  CANCEL_URL:      'mm1kLkrvLnOTF0VyfS0Q',
} as const

// Custom field IDs on the contact object. Most contact fields are read by
// their object key ({{contact.something}}) because that's self-documenting,
// but the key can be renamed in GHL and the id can't — so where we know the
// id, it's the fallback that keeps the sync working through a rename.
export const GHL_CONTACT_FIELDS = {
  NONPROFITS: '5lciQdYMkGh7nhNBl8UK', // {{contact.nonprofits}}
} as const

// ---- Referral partners --------------------------------------

// Membership fee used to compute referral-partner commission. Commission is
// recurring: a partner earns `percentage`% of this fee EACH month a referred
// member stays a paying member, for up to COMMISSION_TERM_MONTHS months, and it
// stops the month the member cancels.
export const MEMBERSHIP_FEE_USD = 100
export const DEFAULT_REFERRAL_PERCENTAGE = 10

// A referred membership earns commission for at most this many months.
export const COMMISSION_TERM_MONTHS = 12

// A partner is only paid once their unpaid balance reaches this threshold;
// below it, the balance rolls over to the next payout run.
export const PAYOUT_THRESHOLD_USD = 100

// Commission is settled as credit by default — it lands in the partner's member
// credit wallet, spendable on golf once they hold a membership. Cash and coupon
// remain for a partner with no LinkUp account, who has no wallet to credit.
export const PAYOUT_METHODS = ['credit', 'cash', 'coupon'] as const

export const PAYOUT_METHOD_LABEL: Record<PayoutMethod, string> = {
  credit: 'Credit',
  cash:   'Cash',
  coupon: 'Coupon',
}

// ---- Hosts --------------------------------------------------

// A hosted event's displayed member price is the host's member guest rate plus
// this fixed markup. Only the guest rate is stored; the host never sets the
// member price directly, and the earned credit is based on the guest rate.
export const HOST_MEMBER_PRICE_MARKUP_USD = 10

// Every hosted round is listed on the same terms, so a host proposes a venue and
// dates and nothing else. Two numbers used to be theirs to type, which meant the
// same round could cost two different things depending on who listed it.
//
// The guest rate is also what the host earns back in credits once the round is
// verified (award_host_event_credit defaults the award to it), which is why the
// form can promise a flat figure. Keep the invariant below in mind if either
// number moves: rate + markup is the standard round price members already pay.
export const HOST_EVENT_GUEST_RATE_USD = 150

// Capacity is deliberately NOT a constant. A round is listed with the spots its
// venue actually has that day (see openSpotsByDate), because two days at the
// same club routinely differ — a flat number would oversell the thin ones and
// waste the busy ones.

export const GHL_CANCEL_BOOKING_URL = 'https://api.leadconnectorhq.com/widget/cancel-booking'
export const GHL_CALENDAR_PROVIDER_ID = 'bdd10QRepJvC6EYoy32m'

// Inbound webhook (GHL workflow trigger) fired alongside each booking
// reminder push notification — see /api/cron/booking-reminders. Path only;
// combine with GHL_BASE_URL like every other GHL request (see ghlFetch).
export const GHL_BOOKING_REMINDER_WEBHOOK_PATH =
  '/hooks/J3tfnLdEv4WmE3XorQYW/webhook-trigger/274c8b8d-551e-4225-9702-6539308d84fb'

// Inbound webhook (GHL workflow trigger) fired when an admin sends a one-off
// payment reminder for an unpaid booking — see
// /api/admin/bookings/[id]/remind-payment. Path only; combine with
// GHL_BASE_URL like every other GHL request.
export const GHL_PAYMENT_REMINDER_WEBHOOK_PATH =
  '/hooks/J3tfnLdEv4WmE3XorQYW/webhook-trigger/819a61da-ce63-4dcc-a608-682c3c0524d7'

// Inbound webhook (GHL workflow trigger) fired when an admin takes a live
// hosted event down — see POST /api/admin/hosted-events/[id]. The host gets a
// push immediately; this is the email copy of the same news, composed and sent
// by the GHL workflow.
//
// NOT YET CREATED. Build the workflow in GHL, then paste its webhook-trigger
// path here — same shape as the two above, path only. Until then
// triggerHostedEventTakedownWebhook no-ops and logs that it skipped, so a
// takedown still works and still pushes; only the email is missing.
//
// The workflow receives: firstName, email, courseName, eventDate, reason,
// releasedCount.
export const GHL_HOSTED_EVENT_TAKEDOWN_WEBHOOK_PATH = ''

// ---- Membership sign-up (public marketing site) -------------
// Shown to a host or referral partner who has credit but no membership to
// spend it against. Two doors on purpose: one for someone ready to pay, one
// for someone who wants to read first.
export const MEMBERSHIP_CHECKOUT_URL = 'https://linkup.golf/golf-membership-checkout'
export const MEMBERSHIP_JOIN_URL     = 'https://linkup.golf/join'

// ---- Aviara course ------------------------------------------

export const AVIARA_ADDRESS  = 'Aviara Golf Club, 7447 Batiquitos Drive, Carlsbad, CA 92011'
export const AVIARA_TIMEZONE = 'America/Los_Angeles'

// ---- Booking ------------------------------------------------

export const BOOKING_PRICE_USD           = 160   // per player, USD
// How long a round runs is a per-course setting owned by that course's GHL
// calendar (its slotDuration). Read it with getCalendarBookingRules() — never
// assume a duration. This is only the last-resort fallback for when GHL can't
// be reached and the course row has nothing stored; it mirrors the DB default
// of courses.meeting_duration_mins.
export const FALLBACK_ROUND_DURATION_MINUTES = 300
// Fallback daily booking cap per course when courses.max_players_per_day is
// unset. Mirrors the column's DB default.
export const DEFAULT_MAX_PLAYERS_PER_DAY = 15

// ---- Cancellation policy tiers ------------------------------

export const POLICY_TIERS = [
  {
    hoursMin: 72,
    credit: '100% credit',
    label:  '72+ hours prior',
    desc:   'Full credit applied to a future round',
    color:  '#166534',
    bg:     'rgba(34,197,94,0.08)',
  },
  {
    hoursMin: 48,
    credit: '50% credit',
    label:  '48–72 hours prior',
    desc:   '50% credit applied to a future round',
    color:  '#92640a',
    bg:     'rgba(234,179,8,0.08)',
  },
  {
    hoursMin: -Infinity,
    credit: 'No credit',
    label:  'Under 48 hours',
    desc:   'No credit — complete loss',
    color:  '#dc2626',
    bg:     'rgba(220,38,38,0.07)',
  },
] as const

export type PolicyTier = typeof POLICY_TIERS[number]
