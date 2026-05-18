import { http, HttpResponse } from 'msw'
import {
  mockMembers, mockCurrentUser, mockCourse, mockCourseMemberships,
  mockBookings, mockAnnouncements, mockPromotions,
  mockConversations, mockParticipants, mockMessages,
  mockReferrals, mockFocusLinkups, mockGuestAccessRequests,
  mockBookingSlots, MOCK_USER_ID,
} from './data'

// ---- Helpers ---------------------------------------------------

// Supabase sends Accept: application/vnd.pgrst.object+json for .single() calls.
// PostgREST responds with a plain object (not array) in that case.
const isSingleRequest = (request: Request) =>
  request.headers.get('Accept')?.includes('pgrst.object') ?? false

// Find a record by Supabase eq filter, e.g. "?id=eq.abc123"
const filterById = <T extends { id: string }>(records: T[], url: URL, param = 'id'): T | undefined => {
  const raw = url.searchParams.get(param)
  if (!raw?.startsWith('eq.')) return records[0]
  const id = raw.replace('eq.', '')
  return records.find(r => r.id === id)
}

// Return either a single object or array based on Accept header
const supabaseResponse = <T>(request: Request, records: T[], single?: T) => {
  if (isSingleRequest(request)) {
    const record = single ?? records[0]
    return record
      ? HttpResponse.json(record)
      : new HttpResponse(null, { status: 406 })
  }
  return HttpResponse.json(records)
}

// ---- Supabase REST handlers ------------------------------------
// Patterns match any Supabase project URL via regex on the path

export const handlers = [

  // ---- members ------------------------------------------------
  http.get(/\/rest\/v1\/members/, ({ request }) => {
    const url = new URL(request.url)

    if (isSingleRequest(request)) {
      const found = filterById(mockMembers, url)
      return found
        ? HttpResponse.json(found)
        : new HttpResponse(null, { status: 406 })
    }

    // Filter by member_id for conversations-participant lookups
    const memberIdFilter = url.searchParams.get('id')
    if (memberIdFilter?.startsWith('eq.')) {
      const id = memberIdFilter.replace('eq.', '')
      return HttpResponse.json(mockMembers.filter(m => m.id === id))
    }

    return HttpResponse.json(mockMembers)
  }),

  // ---- member_profiles ----------------------------------------
  http.get(/\/rest\/v1\/member_profiles/, ({ request }) => {
    const url = new URL(request.url)
    const profiles = mockMembers.map(m => m.profile).filter(Boolean)
    return supabaseResponse(request, profiles, filterById(profiles as { id: string }[], url))
  }),

  http.patch(/\/rest\/v1\/member_profiles/, () => {
    return HttpResponse.json({ success: true })
  }),

  // ---- courses ------------------------------------------------
  http.get(/\/rest\/v1\/courses/, ({ request }) => {
    return supabaseResponse(request, [mockCourse], mockCourse)
  }),

  // ---- course_memberships -------------------------------------
  http.get(/\/rest\/v1\/course_memberships/, () => {
    return HttpResponse.json(mockCourseMemberships)
  }),

  // ---- bookings -----------------------------------------------
  http.get(/\/rest\/v1\/bookings/, ({ request }) => {
    const url = new URL(request.url)
    const memberFilter = url.searchParams.get('member_id')
    let results = mockBookings

    if (memberFilter?.startsWith('eq.')) {
      const mid = memberFilter.replace('eq.', '')
      results = mockBookings.filter(b => b.member_id === mid)
    }

    return supabaseResponse(request, results, results[0])
  }),

  http.post(/\/rest\/v1\/bookings/, () => {
    return HttpResponse.json({ id: 'booking-mock-new', status: 'confirmed' }, { status: 201 })
  }),

  // ---- announcements ------------------------------------------
  http.get(/\/rest\/v1\/announcements/, () => {
    return HttpResponse.json(mockAnnouncements)
  }),

  http.post(/\/rest\/v1\/announcements/, () => {
    return HttpResponse.json({ id: 'ann-mock-new' }, { status: 201 })
  }),

  // ---- promotions ---------------------------------------------
  http.get(/\/rest\/v1\/promotions/, () => {
    return HttpResponse.json(mockPromotions)
  }),

  // ---- conversations ------------------------------------------
  http.get(/\/rest\/v1\/conversations/, ({ request }) => {
    return supabaseResponse(request, mockConversations, mockConversations[0])
  }),

  http.post(/\/rest\/v1\/conversations/, () => {
    return HttpResponse.json({ id: 'conv-mock-new' }, { status: 201 })
  }),

  // ---- conversation_participants ------------------------------
  http.get(/\/rest\/v1\/conversation_participants/, ({ request }) => {
    const url = new URL(request.url)
    const convFilter = url.searchParams.get('conversation_id')
    let results = mockParticipants

    if (convFilter?.startsWith('eq.')) {
      const cid = convFilter.replace('eq.', '')
      results = mockParticipants.filter(p => p.conversation_id === cid)
    }

    return HttpResponse.json(results)
  }),

  http.post(/\/rest\/v1\/conversation_participants/, () => {
    return HttpResponse.json({ id: 'cp-mock-new' }, { status: 201 })
  }),

  http.patch(/\/rest\/v1\/conversation_participants/, () => {
    return HttpResponse.json({ success: true })
  }),

  // ---- messages -----------------------------------------------
  http.get(/\/rest\/v1\/messages/, ({ request }) => {
    const url = new URL(request.url)
    const convFilter = url.searchParams.get('conversation_id')
    let results = mockMessages

    if (convFilter?.startsWith('eq.')) {
      const cid = convFilter.replace('eq.', '')
      results = mockMessages.filter(m => m.conversation_id === cid)
    }

    return HttpResponse.json(results)
  }),

  http.post(/\/rest\/v1\/messages/, async ({ request }) => {
    const body = await request.json() as Record<string, unknown>
    return HttpResponse.json({
      id: `msg-mock-${Date.now()}`,
      conversation_id: body['conversation_id'],
      sender_id: MOCK_USER_ID,
      body: body['body'],
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
    }, { status: 201 })
  }),

  // ---- referrals ----------------------------------------------
  http.get(/\/rest\/v1\/referrals/, () => {
    return HttpResponse.json(mockReferrals)
  }),

  http.post(/\/rest\/v1\/referrals/, () => {
    return HttpResponse.json({ id: 'ref-mock-new' }, { status: 201 })
  }),

  // ---- focus_linkups ------------------------------------------
  http.get(/\/rest\/v1\/focus_linkups/, () => {
    return HttpResponse.json(mockFocusLinkups)
  }),

  // ---- focus_linkup_subscriptions ----------------------------
  http.get(/\/rest\/v1\/focus_linkup_subscriptions/, () => {
    return HttpResponse.json([])
  }),

  http.post(/\/rest\/v1\/focus_linkup_subscriptions/, () => {
    return HttpResponse.json({ id: 'fls-mock-new' }, { status: 201 })
  }),

  http.delete(/\/rest\/v1\/focus_linkup_subscriptions/, () => {
    return new HttpResponse(null, { status: 204 })
  }),

  // ---- guest_access_requests ----------------------------------
  http.get(/\/rest\/v1\/guest_access_requests/, () => {
    return HttpResponse.json(mockGuestAccessRequests)
  }),

  http.post(/\/rest\/v1\/guest_access_requests/, () => {
    return HttpResponse.json({ id: 'gar-mock-new' }, { status: 201 })
  }),

  // ---- push_subscriptions -------------------------------------
  http.get(/\/rest\/v1\/push_subscriptions/, () => {
    return HttpResponse.json([])
  }),

  http.post(/\/rest\/v1\/push_subscriptions/, () => {
    return HttpResponse.json({ id: 'ps-mock-new' }, { status: 201 })
  }),

  // ---- play_suggestions ---------------------------------------
  http.get(/\/rest\/v1\/play_suggestions/, () => {
    return HttpResponse.json([])
  }),

  // ---- Internal Next.js API routes ---------------------------

  // Booking slots
  http.get('/api/bookings/create', ({ request }) => {
    return HttpResponse.json({ slots: mockBookingSlots })
  }),

  // Booking creation
  http.post('/api/bookings/create', () => {
    return HttpResponse.json({ success: true, bookingId: 'booking-mock-new' })
  }),

  // Push notification subscription
  http.get('/api/push/subscribe', () => {
    return HttpResponse.json({ publicKey: 'mock-vapid-public-key' })
  }),

  http.post('/api/push/subscribe', () => {
    return HttpResponse.json({ success: true })
  }),

  http.delete('/api/push/subscribe', () => {
    return new HttpResponse(null, { status: 204 })
  }),

  // Magic link (auth bypass active so this won't be called, but here for completeness)
  http.post('/api/auth/magic-link', () => {
    return HttpResponse.json({ success: true })
  }),
]
