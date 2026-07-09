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
import { GHL_BASE_URL, GHL_API_VERSION, GHL_OPPORTUNITY_SOURCE, GHL_DEFAULT_ASSIGNEE_ID, GHL_CALENDAR_PROVIDER_ID, GOLF_ROUND_DURATION_MINUTES, GHL_BOOKING_REMINDER_WEBHOOK_PATH, GHL_PAYMENT_REMINDER_WEBHOOK_PATH } from '@/lib/constants'

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
    let parsedBody: unknown
    try { parsedBody = JSON.parse(body) } catch { /* not JSON */ }
    throw new GHLError(`GHL API error ${res.status}`, code, { path, statusCode: res.status, body: parsedBody })
  }

  // Some endpoints (e.g. DELETE) return 204 / an empty body — parsing that as
  // JSON would throw and be mistaken for a request failure.
  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  return JSON.parse(text) as T
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

// Like getContactById, but rethrows as a GHLError instead of collapsing every
// failure to null — used only by validateGHLMembership, which must tell "GHL
// is genuinely down" (fail secure to cache) apart from "contact was actually
// deleted" (fail closed, wipe cache). A raw fetch/network error here would
// otherwise be indistinguishable from a real 404 and treated as a revoked
// membership on every transient GHL outage.
export async function getContactByIdStrict(contactId: string): Promise<GHLContact | null> {
  try {
    const res = await getClient().contacts.getContact({ contactId })
    const contact = (res as { contact?: GHLContact })?.contact
    return contact ?? null
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status
    if (status === 404) return null
    logger.warn('getContactByIdStrict failed', { action: 'ghl_contact_lookup', errorMessage: String(err) })
    throw new GHLError('GHL contact lookup failed', ErrorCode.GHL_UNAVAILABLE, { contactId, statusCode: status })
  }
}

export async function createContact(params: {
  firstName: string
  lastName: string
  email: string
  phone?: string | null
}): Promise<string> {
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
    const id = data.contact?.id
    if (!id) throw new GHLError('GHL did not return a contact id', ErrorCode.GHL_UNAVAILABLE)
    return id
  } catch (err) {
    // Don't silently reuse whatever contact GHL matched on failure (e.g. a
    // "duplicated contacts" rejection by phone/email) — that contact could
    // belong to a different person entirely (like the booker), so misattaching
    // the guest's appointment to it would be worse than failing loudly here.
    const ghlMessage = err instanceof GHLError
      ? (err.context?.body as { message?: string } | undefined)?.message
      : undefined
    logger.warn('createContact failed', { action: 'ghl_contact_create', errorMessage: String(err) })
    throw new GHLError(ghlMessage ?? 'Failed to create GHL contact', ErrorCode.GHL_UNAVAILABLE)
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

// Resolve a contact by email, creating one if it doesn't exist. Used to land
// referred non-members in GHL as leads. Best-effort: returns null (rather than
// throwing) if GHL is unavailable — referral attribution itself lives in our DB,
// so a GHL outage must not block linking.
export async function findOrCreateContactByEmail(params: {
  email: string
  firstName?: string | null
  lastName?: string | null
}): Promise<string | null> {
  try {
    const existing = (await getContactByEmail(params.email))?.id ?? null
    if (existing) return existing
    return await createContact({
      // GHL requires a name; fall back to the email local-part for non-members
      // linked by email only.
      firstName: params.firstName?.trim() || params.email.split('@')[0] || 'Referral',
      lastName: params.lastName?.trim() || '',
      email: params.email,
    })
  } catch (err) {
    logger.warn('findOrCreateContactByEmail failed', { action: 'ghl_contact_find_or_create', errorMessage: String(err) })
    return null
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

// ---- Conversations -------------------------------------------

// Sends an SMS immediately via the GHL Conversations API — no workflow or
// automation involved, unlike triggerWorkflow/triggerBookingReminderWebhook
// below. Used for admin-initiated, one-off nudges (e.g. "please pay now").
export async function sendSms(contactId: string, message: string): Promise<boolean> {
  try {
    await ghlFetch('/conversations/messages', {
      method: 'POST',
      body: JSON.stringify({ type: 'SMS', contactId, message }),
    })
    return true
  } catch (err) {
    logger.warn('sendSms failed', { action: 'ghl_sms_send', errorMessage: String(err) })
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

// Fires the GHL inbound webhook used for booking reminders (7d/3d/6h before
// a tee time) — a plain POST to a workflow-trigger URL, not the REST API,
// so it doesn't go through ghlFetch/GHL_BASE_URL.
export async function triggerBookingReminderWebhook(payload: {
  type: '7 days' | '3 days' | '6 hours'
  email: string
  firstName: string
  content: string
}): Promise<boolean> {
  try {
    const res = await fetch(`${GHL_BASE_URL}${GHL_BOOKING_REMINDER_WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      logger.warn('triggerBookingReminderWebhook failed', { action: 'ghl_reminder_webhook', metadata: { statusCode: res.status } })
      return false
    }
    return true
  } catch (err) {
    logger.warn('triggerBookingReminderWebhook failed', { action: 'ghl_reminder_webhook', errorMessage: String(err) })
    return false
  }
}

// Fires the GHL inbound webhook used for admin-initiated payment reminders on
// unpaid bookings (tentative / availability_confirmed). Same plain-POST
// pattern as triggerBookingReminderWebhook — the GHL workflow composes and
// sends the actual message; `email` lets it match the target contact.
export async function triggerPaymentReminderWebhook(payload: {
  firstName: string
  eventTime: string
  eventLocation: string
  paymentLink: string
  email?: string
}): Promise<boolean> {
  try {
    const res = await fetch(`${GHL_BASE_URL}${GHL_PAYMENT_REMINDER_WEBHOOK_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      logger.warn('triggerPaymentReminderWebhook failed', { action: 'ghl_payment_reminder_webhook', metadata: { statusCode: res.status } })
      return false
    }
    return true
  } catch (err) {
    logger.warn('triggerPaymentReminderWebhook failed', { action: 'ghl_payment_reminder_webhook', errorMessage: String(err) })
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
  if (!data.id) throw new GHLError('createBooking returned no event id', ErrorCode.GHL_UNAVAILABLE)
  return data.id
}

export async function cancelBooking(eventId: string, contactId?: string): Promise<boolean> {
  try {
    await ghlFetch(`/calendars/events/appointments/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify({
        appointmentStatus: 'cancelled',
        ...(contactId ? { contact: { id: contactId } } : {}),
        toNotify: true,
        channel: 'web_app',
        source: GHL_OPPORTUNITY_SOURCE,
      }),
    })
    return true
  } catch {
    return false
  }
}

// Hard-deletes a GHL appointment/event (as opposed to cancelBooking, which
// only flips its status to "cancelled"). Used when an admin removes a booking
// outright. Returns true when the appointment is gone — including when GHL
// reports it as already deleted (404) — so the caller can proceed to remove
// the Supabase row. Returns false only on a genuine failure.
export async function deleteBooking(eventId: string): Promise<boolean> {
  try {
    await ghlFetch(`/calendars/events/appointments/${eventId}`, { method: 'DELETE' })
    return true
  } catch (err) {
    // The appointment no longer exists in GHL — treat as already deleted.
    if (err instanceof GHLError && err.context?.['statusCode'] === 404) {
      logger.info('deleteBooking: appointment already gone in GHL', {
        action: 'ghl_booking_delete',
        metadata: { eventId },
      })
      return true
    }
    logger.warn('deleteBooking failed', {
      action: 'ghl_booking_delete',
      errorMessage: String(err),
      metadata: { eventId },
    })
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

// ---- Calendar management (raw fetch) ------------------------

export async function createGHLCalendar(params: {
  name: string
  slug: string
  eventTitle: string
  eventColor: string
  meetingIntervalMins: number
  meetingDurationMins: number
  minSchedulingNoticeMins: number
  dateRangeDays: number
  preBufferMins: number
  postBufferMins: number
  seatsPerClass?: number | null
}): Promise<string> {
  const data = await ghlFetch<{ calendar?: { id: string }; id?: string }>('/calendars/', {
    method: 'POST',
    body: JSON.stringify({
      name: params.name,
      calendarType: 'class_booking',
      groupId: GHL_CALENDAR_PROVIDER_ID,
      slug: params.slug,
      eventTitle: params.eventTitle,
      eventColor: params.eventColor,
      locationId: GHL_LOCATION_ID,
      isActive: true,
      slotInterval: params.meetingIntervalMins,
      slotDuration: params.meetingDurationMins,
      preBuffer: params.preBufferMins,
      slotBuffer: params.postBufferMins,
      ...(params.seatsPerClass != null ? { appoinmentPerSlot: params.seatsPerClass } : {}),
      allowBookingAfter: params.minSchedulingNoticeMins,
      allowBookingFor: params.dateRangeDays,
    }),
  })
  const id = (data.calendar?.id ?? (data as { id?: string }).id) ?? ''
  if (!id) throw new GHLError('createGHLCalendar returned no id', ErrorCode.GHL_UNAVAILABLE)
  return id
}

export async function createCalendarGroup(params: {
  name: string
  slug: string
  description?: string | null
}): Promise<string> {
  const data = await ghlFetch<{ group?: { id: string } }>('/calendars/groups', {
    method: 'POST',
    body: JSON.stringify({
      name: params.name,
      slug: params.slug,
      locationId: GHL_LOCATION_ID,
      ...(params.description ? { description: params.description } : {}),
    }),
  })
  const id = data.group?.id ?? ''
  if (!id) throw new GHLError('createCalendarGroup returned no id', ErrorCode.GHL_UNAVAILABLE)
  return id
}

export async function deleteGHLCalendar(calendarId: string): Promise<boolean> {
  try {
    await ghlFetch(`/calendars/${calendarId}`, { method: 'DELETE' })
    return true
  } catch {
    return false
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

// ---- Tags list (for admin UI multi-select) ------------------

export async function listLocationTags(): Promise<{ id: string; name: string }[]> {
  try {
    const data = await ghlFetch<{ tags?: { id: string; name: string }[] }>(
      `/locations/${GHL_LOCATION_ID}/tags`
    )
    return data.tags ?? []
  } catch {
    return []
  }
}

// ---- Calendar list (for admin UI calendar selector) ---------

export interface GHLCalendarSummary {
  id: string
  name: string
  calendarType: string
  slug: string | null
  groupId: string | null
  // Booking settings returned by GHL on the calendar object
  slotInterval: number | null
  slotDuration: number | null
  preBuffer: number | null
  slotBuffer: number | null
  appoinmentPerSlot: number | null
  allowBookingAfter: number | null
  allowBookingFor: number | null
}

export async function listCalendars(): Promise<GHLCalendarSummary[]> {
  try {
    // Fetch all calendars for this location then also try the groups endpoint
    // to ensure we get every calendar including those in groups.
    const [calsData, groupsData] = await Promise.allSettled([
      ghlFetch<{ calendars?: GHLCalendarSummary[] }>(`/calendars/?locationId=${GHL_LOCATION_ID}`),
      ghlFetch<{ groups?: { id: string; calendars?: GHLCalendarSummary[] }[] }>(
        `/calendars/groups?locationId=${GHL_LOCATION_ID}`
      ),
    ])

    const cals: GHLCalendarSummary[] = calsData.status === 'fulfilled' ? (calsData.value.calendars ?? []) : []

    // Merge in any calendars found in groups that aren't in the main list
    if (groupsData.status === 'fulfilled') {
      for (const group of groupsData.value.groups ?? []) {
        for (const cal of group.calendars ?? []) {
          if (!cals.find(c => c.id === cal.id)) cals.push({ ...cal, groupId: group.id })
        }
      }
    }

    return cals
  } catch {
    return []
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
