// ============================================================
// LinkUp Golf — Go High Level API Client
// All GHL operations go through this file.
// Server-side only — never import in client components.
// ============================================================

import type { GHLContact, GHLCalendarEvent, GHLBookingSlot } from '@/types'

const GHL_BASE_URL = 'https://services.leadconnectorhq.com'
const GHL_API_KEY = process.env.GHL_API_KEY!
const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID!

// ---- Base fetch wrapper -------------------------------------

async function ghlFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${GHL_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${GHL_API_KEY}`,
      'Content-Type': 'application/json',
      Version: '2021-07-28',
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`GHL API error ${res.status}: ${body}`)
  }

  return res.json()
}

// ---- Contacts -----------------------------------------------

/**
 * Look up a GHL contact by email address.
 * Returns null if not found.
 */
export async function getContactByEmail(email: string): Promise<GHLContact | null> {
  try {
    const data = await ghlFetch<{ contacts: GHLContact[] }>(
      `/contacts/?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`
    )
    return data.contacts?.[0] ?? null
  } catch {
    return null
  }
}

/**
 * Get a GHL contact by their contact ID.
 */
export async function getContactById(contactId: string): Promise<GHLContact | null> {
  try {
    const data = await ghlFetch<{ contact: GHLContact }>(`/contacts/${contactId}`)
    return data.contact ?? null
  } catch {
    return null
  }
}

/**
 * Update fields on a GHL contact record.
 */
export async function updateContact(
  contactId: string,
  fields: Partial<{
    firstName: string
    lastName: string
    phone: string
    tags: string[]
  }>
): Promise<boolean> {
  try {
    await ghlFetch(`/contacts/${contactId}`, {
      method: 'PUT',
      body: JSON.stringify(fields),
    })
    return true
  } catch {
    return false
  }
}

/**
 * Check whether a contact has a specific GHL tag.
 * Used for access control.
 */
export function contactHasTag(contact: GHLContact, tag: string): boolean {
  return contact.tags?.includes(tag) ?? false
}

/**
 * Add a tag to a GHL contact.
 */
export async function addTagToContact(contactId: string, tag: string): Promise<boolean> {
  try {
    await ghlFetch(`/contacts/${contactId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tags: [tag] }),
    })
    return true
  } catch {
    return false
  }
}

/**
 * Remove a tag from a GHL contact.
 */
export async function removeTagFromContact(contactId: string, tag: string): Promise<boolean> {
  try {
    await ghlFetch(`/contacts/${contactId}/tags`, {
      method: 'DELETE',
      body: JSON.stringify({ tags: [tag] }),
    })
    return true
  } catch {
    return false
  }
}

// ---- Bookings / Calendar ------------------------------------

/**
 * Get available tee time slots for a given calendar and date range.
 * calendarId is the GHL calendar ID for the specific course.
 */
export async function getAvailableSlots(
  calendarId: string,
  startDate: string, // ISO date string: "2026-05-15"
  endDate: string    // ISO date string: "2026-05-15"
): Promise<GHLBookingSlot[]> {
  try {
    const start = new Date(startDate).getTime()
    const end = new Date(endDate).getTime() + 86400000 // end of day
    const data = await ghlFetch<{ slots: GHLBookingSlot[] }>(
      `/calendars/${calendarId}/free-slots?startDate=${start}&endDate=${end}&timezone=America/Los_Angeles`
    )
    return data.slots ?? []
  } catch {
    return []
  }
}

/**
 * Create a calendar booking in GHL.
 * Returns the GHL event ID on success, null on failure.
 */
export async function createBooking(params: {
  calendarId: string
  contactId: string
  startTime: string   // ISO datetime: "2026-05-15T07:00:00-07:00"
  endTime: string
  title: string
  notes?: string
}): Promise<string | null> {
  try {
    const data = await ghlFetch<{ event: GHLCalendarEvent }>('/calendars/events', {
      method: 'POST',
      body: JSON.stringify({
        calendarId: params.calendarId,
        locationId: GHL_LOCATION_ID,
        contactId: params.contactId,
        startTime: params.startTime,
        endTime: params.endTime,
        title: params.title,
        notes: params.notes ?? '',
      }),
    })
    return data.event?.id ?? null
  } catch {
    return null
  }
}

/**
 * Cancel a booking in GHL by event ID.
 */
export async function cancelBooking(eventId: string): Promise<boolean> {
  try {
    await ghlFetch(`/calendars/events/${eventId}`, { method: 'DELETE' })
    return true
  } catch {
    return false
  }
}

/**
 * Get upcoming bookings for a contact from GHL.
 */
export async function getContactBookings(contactId: string): Promise<GHLCalendarEvent[]> {
  try {
    const now = Date.now()
    const future = now + 60 * 24 * 60 * 60 * 1000 // 60 days out
    const data = await ghlFetch<{ events: GHLCalendarEvent[] }>(
      `/calendars/events?locationId=${GHL_LOCATION_ID}&contactId=${contactId}&startTime=${now}&endTime=${future}`
    )
    return data.events ?? []
  } catch {
    return []
  }
}

// ---- Payments -----------------------------------------------

/**
 * Charge a member for a booking via GHL/Stripe.
 * Uses the card already on file in their GHL contact record.
 * Returns the Stripe payment intent ID on success, null on failure.
 */
export async function chargeForBooking(params: {
  contactId: string
  amountCents: number   // in cents, e.g. 16000 for $160.00
  description: string
}): Promise<string | null> {
  try {
    const data = await ghlFetch<{ payment: { id: string; status: string } }>(
      '/payments/orders',
      {
        method: 'POST',
        body: JSON.stringify({
          locationId: GHL_LOCATION_ID,
          contactId: params.contactId,
          amount: params.amountCents,
          currency: 'usd',
          description: params.description,
          paymentMethod: 'card_on_file', // charges the Stripe card on file
        }),
      }
    )
    if (data.payment?.status === 'succeeded') {
      return data.payment.id
    }
    return null
  } catch {
    return null
  }
}

// ---- Emails / Notifications (via GHL workflows) -------------

/**
 * Trigger a GHL workflow by name.
 * Used to send emails (invitation, welcome, referral, etc.)
 * Workflow must be set up in GHL to receive a webhook trigger.
 */
export async function triggerWorkflow(params: {
  workflowId: string
  contactId: string
  customData?: Record<string, string>
}): Promise<boolean> {
  try {
    await ghlFetch(`/workflows/${params.workflowId}/subscribe`, {
      method: 'POST',
      body: JSON.stringify({
        contactId: params.contactId,
        ...params.customData,
      }),
    })
    return true
  } catch {
    return false
  }
}

// ---- GHL Workflow IDs (configure these in your GHL account) -
// Store actual IDs in environment variables for flexibility

export const GHL_WORKFLOWS = {
  SEND_MAGIC_LINK:      process.env.GHL_WORKFLOW_MAGIC_LINK ?? '',
  WELCOME_NEW_MEMBER:   process.env.GHL_WORKFLOW_WELCOME ?? '',
  REFERRAL_INVITE:      process.env.GHL_WORKFLOW_REFERRAL ?? '',
  BOOKING_CONFIRMATION: process.env.GHL_WORKFLOW_BOOKING_CONFIRM ?? '',
  FOCUS_LINKUP_2W:      process.env.GHL_WORKFLOW_FOCUS_2W ?? '',
  FOCUS_LINKUP_1W:      process.env.GHL_WORKFLOW_FOCUS_1W ?? '',
}
