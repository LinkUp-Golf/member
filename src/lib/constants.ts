// ============================================================
// App-wide constants
// Business logic values, IDs, and configuration that are used
// across multiple files. Environment-specific secrets stay in
// .env.local; these are stable values that live in code.
// ============================================================

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

// ---- Referral partners --------------------------------------

// Membership fee used to compute referral-partner commission
// (commission = converted members × MEMBERSHIP_FEE_USD × percentage / 100).
export const MEMBERSHIP_FEE_USD = 100
export const DEFAULT_REFERRAL_PERCENTAGE = 10

// ---- Hosts --------------------------------------------------

// A hosted event's displayed member price is the host's member guest rate plus
// this fixed markup. Only the guest rate is stored; the host never sets the
// member price directly, and the earned credit is based on the guest rate.
export const HOST_MEMBER_PRICE_MARKUP_USD = 10

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
