// ============================================================
// LinkUp Golf — GoHighLevel API Client
// Uses the official @gohighlevel/api-client SDK for contacts,
// tags, and workflows. Raw fetch retained only for calendar
// free-slot queries which are not yet in the SDK.
// Server-side only — never import in client components.
// ============================================================

import { HighLevel } from '@gohighlevel/api-client'
import type { GHLContact, GHLCalendarEvent, GHLBookingSlot } from '@/types'
import { GHLError, ErrorCode } from '@/lib/errors/app-error'
import { logger } from '@/lib/logger'

const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID!
const GHL_BASE_URL = 'https://services.leadconnectorhq.com'

// ---- SDK client (singleton) ---------------------------------
// Initialized lazily so the process startup doesn't fail if the
// env var is missing during tests or build time.
let _client: HighLevel | null = null

function getClient(): HighLevel {
  if (!_client) {
    if (!process.env.GHL_API_KEY) throw new GHLError('GHL_API_KEY is not set', ErrorCode.GHL_UNAVAILABLE)
    _client = new HighLevel({ privateIntegrationToken: process.env.GHL_API_KEY })
  }
  return _client
}

// ---- Raw fetch for endpoints not covered by the SDK ---------
async function ghlFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${GHL_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      'Content-Type': 'application/json',
      Version: '2021-07-28',
      ...options.headers,
    },
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    const code = res.status === 404 ? ErrorCode.GHL_CONTACT_NOT_FOUND : ErrorCode.GHL_UNAVAILABLE
    logger.error(`GHL ${res.status} ${path}: ${body.slice(0, 200)}`, { action: 'ghl_fetch_error', statusCode: res.status })
    throw new GHLError(`GHL API error ${res.status}`, code, { path, statusCode: res.status })
  }

  return res.json() as Promise<T>
}

// ---- Contacts -----------------------------------------------

export async function getContactByEmail(email: string): Promise<GHLContact | null> {
  try {
    const res = await getClient().contacts.getDuplicateContact({ locationId: GHL_LOCATION_ID, email })
    const contact = (res as { contact?: GHLContact })?.contact
    return contact ?? null
  } catch (err) {
    logger.warn('getContactByEmail failed', { action: 'ghl_contact_lookup', errorMessage: String(err) })
    return null
  }
}

export async function getContactById(contactId: string): Promise<GHLContact | null> {
  try {
    const res = await getClient().contacts.getContact({ contactId })
    const contact = (res as { contact?: GHLContact })?.contact
    return contact ?? null
  } catch (err) {
    logger.warn('getContactById failed', { action: 'ghl_contact_lookup', errorMessage: String(err) })
    return null
  }
}

export async function updateContact(
  contactId: string,
  fields: Partial<{ firstName: string; lastName: string; phone: string; tags: string[] }>
): Promise<boolean> {
  try {
    await getClient().contacts.updateContact({ contactId }, fields)
    return true
  } catch (err) {
    logger.warn('updateContact failed', { action: 'ghl_contact_update', errorMessage: String(err) })
    return false
  }
}

export function contactHasTag(contact: GHLContact, tag: string): boolean {
  return contact.tags?.includes(tag) ?? false
}

export async function addTagToContact(contactId: string, tag: string): Promise<boolean> {
  try {
    await getClient().contacts.addTags({ contactId }, { tags: [tag] })
    return true
  } catch (err) {
    logger.warn('addTagToContact failed', { action: 'ghl_tag_add', errorMessage: String(err) })
    return false
  }
}

export async function removeTagFromContact(contactId: string, tag: string): Promise<boolean> {
  try {
    await getClient().contacts.removeTags({ contactId }, { tags: [tag] })
    return true
  } catch (err) {
    logger.warn('removeTagFromContact failed', { action: 'ghl_tag_remove', errorMessage: String(err) })
    return false
  }
}

// ---- Emails / Notifications (via GHL workflows) -------------

export async function triggerWorkflow(params: {
  workflowId: string
  contactId: string
  customData?: Record<string, string>
}): Promise<boolean> {
  try {
    await getClient().contacts.addContactToWorkflow(
      { contactId: params.contactId, workflowId: params.workflowId },
      { eventStartTime: new Date().toISOString(), ...params.customData }
    )
    return true
  } catch (err) {
    logger.warn('triggerWorkflow failed', { action: 'ghl_workflow_trigger', errorMessage: String(err) })
    return false
  }
}

// ---- Calendar (raw fetch — not yet in SDK) ------------------

export async function getAvailableSlots(
  calendarId: string,
  startDate: string,
  endDate: string
): Promise<GHLBookingSlot[]> {
  try {
    const start = new Date(startDate).getTime()
    const end = new Date(endDate).getTime() + 86400000
    const data = await ghlFetch<{ slots: GHLBookingSlot[] }>(
      `/calendars/${calendarId}/free-slots?startDate=${start}&endDate=${end}&timezone=America/Los_Angeles`
    )
    return data.slots ?? []
  } catch {
    return []
  }
}

export async function createBooking(params: {
  calendarId: string
  contactId: string
  startTime: string
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

export async function cancelBooking(eventId: string): Promise<boolean> {
  try {
    await ghlFetch(`/calendars/events/${eventId}`, { method: 'DELETE' })
    return true
  } catch {
    return false
  }
}

export async function getContactBookings(contactId: string): Promise<GHLCalendarEvent[]> {
  try {
    const now = Date.now()
    const future = now + 60 * 24 * 60 * 60 * 1000
    const data = await ghlFetch<{ events: GHLCalendarEvent[] }>(
      `/calendars/events?locationId=${GHL_LOCATION_ID}&contactId=${contactId}&startTime=${now}&endTime=${future}`
    )
    return data.events ?? []
  } catch {
    return []
  }
}

// ---- Payments (raw fetch — SDK payment API differs) ---------

export async function chargeForBooking(params: {
  contactId: string
  amountCents: number
  description: string
}): Promise<string | null> {
  try {
    const data = await ghlFetch<{ payment: { id: string; status: string } }>('/payments/orders', {
      method: 'POST',
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        contactId: params.contactId,
        amount: params.amountCents,
        currency: 'usd',
        description: params.description,
        paymentMethod: 'card_on_file',
      }),
    })
    return data.payment?.status === 'succeeded' ? data.payment.id : null
  } catch {
    return null
  }
}

// ---- Workflow ID constants ----------------------------------

export const GHL_WORKFLOWS = {
  SEND_MAGIC_LINK:      process.env.GHL_WORKFLOW_MAGIC_LINK ?? '',
  WELCOME_NEW_MEMBER:   process.env.GHL_WORKFLOW_WELCOME ?? '',
  REFERRAL_INVITE:      process.env.GHL_WORKFLOW_REFERRAL ?? '',
  BOOKING_CONFIRMATION: process.env.GHL_WORKFLOW_BOOKING_CONFIRM ?? '',
  FOCUS_LINKUP_2W:      process.env.GHL_WORKFLOW_FOCUS_2W ?? '',
  FOCUS_LINKUP_1W:      process.env.GHL_WORKFLOW_FOCUS_1W ?? '',
}
