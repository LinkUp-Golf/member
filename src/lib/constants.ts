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

export const GHL_CANCEL_BOOKING_URL = 'https://api.leadconnectorhq.com/widget/cancel-booking'
export const GHL_CALENDAR_PROVIDER_ID = 'bdd10QRepJvC6EYoy32m'

// ---- Aviara course ------------------------------------------

export const AVIARA_ADDRESS  = 'Aviara Golf Club, 7447 Batiquitos Drive, Carlsbad, CA 92011'
export const AVIARA_TIMEZONE = 'America/Los_Angeles'

// ---- Booking ------------------------------------------------

export const BOOKING_PRICE_USD           = 160   // per player, USD
export const GOLF_ROUND_DURATION_MINUTES = 300   // 5 hours
export const BOOKING_PAYMENT_URL         = 'https://linkupgolf-services.com/aviara-event-booking-checkout-page'

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
