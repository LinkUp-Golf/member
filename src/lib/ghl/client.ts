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
import { GHL_BASE_URL, GHL_API_VERSION, GHL_OPPORTUNITY_SOURCE, GHL_DEFAULT_ASSIGNEE_ID, GHL_CALENDAR_PROVIDER_ID, GOLF_ROUND_DURATION_MINUTES } from '@/lib/constants'

const GHL_LOCATION_ID = process.env.GHL_LOCATION_ID ?? ''

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
      Version: GHL_API_VERSION,
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

export async function createContact(params: {
  firstName: string
  lastName: string
  email: string
  phone?: string | null
}): Promise<string | null> {
  try {
    const data = await ghlFetch<{ contact: { id: string } }>('/contacts', {
      method: 'POST',
      body: JSON.stringify({
        locationId: GHL_LOCATION_ID,
        firstName: params.firstName,
        lastName: params.lastName,
        email: params.email,
        ...(params.phone ? { phone: params.phone } : {}),
      }),
    })
    return data.contact?.id ?? null
  } catch (err) {
    logger.warn('createContact failed', { action: 'ghl_contact_create', errorMessage: String(err) })
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

// Cached location timezone — fetched once per process lifetime.
// GHL: GET /locations/:locationId/timezones → { timezones: string[] }
// The first entry is the location's configured timezone.
let _locationTimezone: string | null = null

// fallback is used when GHL returns no timezone data; callers should pass the
// user's request timezone so we never silently fall through to a wrong offset.
export async function getLocationTimezone(fallback?: string): Promise<string> {
  if (_locationTimezone) return _locationTimezone
  try {
    const data = await ghlFetch<{ timezones: string[] }>(
      `/locations/${GHL_LOCATION_ID}/timezones`
    )
    const tz = Array.isArray(data.timezones) ? data.timezones[0] : null
    if (tz) {
      _locationTimezone = tz
      return tz
    }
  } catch (err) {
    logger.warn('getLocationTimezone failed', { action: 'ghl_location_timezone', errorMessage: String(err) })
  }
  return fallback ?? Intl.DateTimeFormat().resolvedOptions().timeZone
}

// Response shape: { "YYYY-MM-DD": { slots: { "ISO_DATETIME": spotsOpen } }, traceId: "..." }
// Returns a map of date string → slot array so the UI can show the full month at once.
export async function getAvailableSlots(params: {
  calendarId: string
  startDate: string  // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
  timezone: string
  userId?: string
  sendSeatsPerSlot?: boolean
}): Promise<Record<string, GHLBookingSlot[]>> {
  try {
    const startMs = new Date(params.startDate).getTime()
    const endMs = new Date(params.endDate + 'T23:59:59').getTime()

    const qs = new URLSearchParams({
      startDate: String(startMs),
      endDate: String(endMs),
      timezone: params.timezone,
    })
    if (params.userId) qs.set('userId', params.userId)
    if (params.sendSeatsPerSlot) qs.set('sendSeatsPerSlot', 'true')

    const data = await ghlFetch<Record<string, { slots: Record<string, number> } | string>>(
      `/calendars/${params.calendarId}/free-slots?${qs}`
    )

    const result: Record<string, GHLBookingSlot[]> = {}
    for (const [dateKey, value] of Object.entries(data)) {
      if (dateKey === 'traceId' || typeof value !== 'object' || !value.slots) continue
      result[dateKey] = []
      for (const [startTime, spotsOpen] of Object.entries(value.slots)) {
        const slotEndMs = new Date(startTime).getTime() + GOLF_ROUND_DURATION_MINUTES * 60 * 1000
        result[dateKey].push({
          startTime,
          endTime: new Date(slotEndMs).toISOString(),
          available: spotsOpen > 0,
          spotsOpen,
        })
      }
      result[dateKey].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    }

    return result
  } catch {
    return {}
  }
}

export async function createBooking(params: {
  calendarId: string
  contact: { id: string; email: string; phone?: string | null }
  startTime: string   // "YYYY-MM-DDTHH:MM:SS±HHMM"
  endTime: string     // "YYYY-MM-DDTHH:MM:SS±HHMM"
  title: string
  timezone: string
  address?: string
}): Promise<string> {
  const data = await ghlFetch<{ id: string }>(
    '/calendars/events/appointments',
    {
      method: 'POST',
      body: JSON.stringify({
        calendarId: params.calendarId,
        locationId: GHL_LOCATION_ID,
        contactId: params.contact.id,
        contact: {
          id: params.contact.id,
          email: params.contact.email,
          phone: params.contact.phone ?? null,
        },
        title: params.title,
        calendarNotes: '',
        internalNote: '',
        startTime: params.startTime,
        endTime: params.endTime,
        selectedTimezone: params.timezone,
        appointmentStatus: 'confirmed',
        ignoreFreeSlotValidation: true,
        ignoreDateRange: true,
        toNotify: true,
        source: GHL_OPPORTUNITY_SOURCE,
        channel: 'web_app',
        calendarProviderId: GHL_CALENDAR_PROVIDER_ID,
        userId: GHL_DEFAULT_ASSIGNEE_ID,
        assignedUserId: GHL_DEFAULT_ASSIGNEE_ID,
        address: params.address ?? '',
        overrideLocationConfig: false,
        isCustomRecurring: false,
      }),
    }
  )
  const id = data.id
  if (!id) throw new GHLError('createBooking returned no event id', ErrorCode.GHL_UNAVAILABLE)
  return id
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

// ---- Contacts list (paginated, by tag) ----------------------

export async function listContactsByTag(tag: string): Promise<GHLContact[]> {
  const all: GHLContact[] = []
  let startAfterId: string | undefined

  for (;;) {
    const qs = new URLSearchParams({ locationId: GHL_LOCATION_ID, tag, limit: '100' })
    if (startAfterId) qs.set('startAfterId', startAfterId)

    const data = await ghlFetch<{
      contacts?: GHLContact[]
      meta?: { startAfterId?: string; nextPage?: boolean }
    }>(`/contacts?${qs}`)

    const page = data.contacts ?? []
    all.push(...page)

    if (!data.meta?.nextPage || page.length === 0) break
    startAfterId = data.meta.startAfterId
  }

  return all
}

// ---- Avi-Play Pipeline (Opportunities) ----------------------

export async function createOpportunity(params: {
  contactId: string
  title: string
  pipelineId: string
  stageId: string
  monetaryValue?: number
  customFields?: Array<{ id: string; fieldValue: string }>
}): Promise<string> {
  const data = await ghlFetch<{ opportunity: { id: string } }>('/opportunities/', {
    method: 'POST',
    body: JSON.stringify({
      pipelineId: params.pipelineId,
      locationId: GHL_LOCATION_ID,
      name: params.title,
      pipelineStageId: params.stageId,
      status: 'open',
      contactId: params.contactId,
      source: GHL_OPPORTUNITY_SOURCE,
      assignedTo: GHL_DEFAULT_ASSIGNEE_ID,
      ...(params.monetaryValue !== undefined ? { monetaryValue: params.monetaryValue } : {}),
      ...(params.customFields?.length ? { customFields: params.customFields } : {}),
    }),
  })
  if (!data.opportunity?.id) throw new GHLError('createOpportunity returned no id', ErrorCode.GHL_UNAVAILABLE)
  return data.opportunity.id
}

export async function updateOpportunityStage(
  opportunityId: string,
  stageId: string,
  status?: 'open' | 'won' | 'lost' | 'abandoned'
): Promise<boolean> {
  try {
    await ghlFetch(`/opportunities/${opportunityId}`, {
      method: 'PUT',
      body: JSON.stringify({
        pipelineStageId: stageId,
        ...(status ? { status } : {}),
      }),
    })
    return true
  } catch (err) {
    logger.warn('updateOpportunityStage failed', { action: 'ghl_opportunity_update', errorMessage: String(err) })
    return false
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
