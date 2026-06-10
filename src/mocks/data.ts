import type {
  Course, Member, MemberProfile, MemberWithProfile,
  Booking, Announcement, Promotion, Conversation,
  ConversationParticipant, Message, Referral,
  FocusLinkup, GuestAccessRequest, CourseMembership,
} from '@/types'

// ---- Stable IDs ------------------------------------------------
export const MOCK_COURSE_ID   = 'course-aviara-0001'
export const MOCK_USER_ID     = 'user-current-0001'
export const MOCK_MEMBER_2_ID = 'user-member-0002'
export const MOCK_MEMBER_3_ID = 'user-member-0003'
export const MOCK_MEMBER_4_ID = 'user-member-0004'
export const MOCK_MEMBER_5_ID = 'user-member-0005'

// ---- Course ----------------------------------------------------
export const mockCourse: Course = {
  id: MOCK_COURSE_ID,
  name: 'Park Hyatt Aviara Golf Club',
  slug: 'aviara',
  city: 'Carlsbad',
  state: 'CA',
  country: 'US',
  access_tag: 'avi member',
  max_members: 200,
  max_rounds_per_month: 300,
  reserved_rounds: 100,
  timezone: 'America/Los_Angeles',
  active: true,
  created_at: '2024-01-01T00:00:00Z',
}

// ---- Profiles --------------------------------------------------
const profiles: Record<string, MemberProfile> = {
  [MOCK_USER_ID]: {
    id: MOCK_USER_ID,
    display_name: 'Fritz Dumdum',
    avatar_url: null,
    business_name: 'Rothbright',
    business_description: 'Strategic advisory and business development.',
    role_title: 'Founder & CEO',
    industry_category: 'Business Owner / Founder',
    value_offered: 'Strategic advisory, business development, investor introductions',
    value_sought: 'Technology partnerships, expansion capital',
    non_golf_hobbies: 'Surfing, travel',
    linkedin_url: null,
    handicap_index: 12.5,
    preferred_play_times: 'Weekday mornings',
    play_frequency: 'Weekly',
    open_to_golf_travel: true,
    family_golfers: 'Spouse occasionally',
    profile_visible: true,
    show_handicap: true,
    updated_at: '2024-01-15T00:00:00Z',
  },
  [MOCK_MEMBER_2_ID]: {
    id: MOCK_MEMBER_2_ID,
    display_name: 'James Whitfield',
    avatar_url: null,
    business_name: 'Whitfield Capital',
    business_description: 'Private equity and venture capital.',
    role_title: 'Managing Partner',
    industry_category: 'Capital Provider',
    value_offered: 'Growth capital, M&A advisory, board experience',
    value_sought: 'Profitable businesses seeking growth equity',
    non_golf_hobbies: 'Skiing, sailing',
    linkedin_url: null,
    handicap_index: 8.2,
    preferred_play_times: 'Weekends',
    play_frequency: 'Twice a month',
    open_to_golf_travel: true,
    family_golfers: null,
    profile_visible: true,
    show_handicap: true,
    updated_at: '2024-02-01T00:00:00Z',
  },
  [MOCK_MEMBER_3_ID]: {
    id: MOCK_MEMBER_3_ID,
    display_name: 'Sarah Chen',
    avatar_url: null,
    business_name: 'Chen & Associates',
    business_description: 'Corporate and transactional law.',
    role_title: 'Partner',
    industry_category: 'Professional Services (Legal)',
    value_offered: 'M&A legal counsel, contract structuring, IP protection',
    value_sought: 'High-growth companies needing outside counsel',
    non_golf_hobbies: 'Wine collecting, tennis',
    linkedin_url: null,
    handicap_index: 18.0,
    preferred_play_times: 'Friday afternoons',
    play_frequency: 'Monthly',
    open_to_golf_travel: false,
    family_golfers: 'Husband plays regularly',
    profile_visible: true,
    show_handicap: false,
    updated_at: '2024-02-10T00:00:00Z',
  },
  [MOCK_MEMBER_4_ID]: {
    id: MOCK_MEMBER_4_ID,
    display_name: 'Marcus Rivera',
    avatar_url: null,
    business_name: 'Coastal Commercial RE',
    business_description: 'Commercial real estate brokerage and development.',
    role_title: 'Principal Broker',
    industry_category: 'Real Estate',
    value_offered: 'Off-market deal flow, NNN leases, 1031 exchanges',
    value_sought: 'Investors seeking stabilized commercial assets',
    non_golf_hobbies: 'Deep sea fishing, CrossFit',
    linkedin_url: null,
    handicap_index: 5.7,
    preferred_play_times: 'Early mornings',
    play_frequency: 'Weekly',
    open_to_golf_travel: true,
    family_golfers: 'Two sons play competitively',
    profile_visible: true,
    show_handicap: true,
    updated_at: '2024-03-01T00:00:00Z',
  },
  [MOCK_MEMBER_5_ID]: {
    id: MOCK_MEMBER_5_ID,
    display_name: 'Diana Okafor',
    avatar_url: null,
    business_name: 'Axiom Health',
    business_description: 'Healthcare technology and clinical operations.',
    role_title: 'CEO',
    industry_category: 'Healthcare / Life Sciences',
    value_offered: 'Healthcare partnerships, clinical trial design, regulatory navigation',
    value_sought: 'MedTech investors, distribution partnerships',
    non_golf_hobbies: 'Marathon running, photography',
    linkedin_url: null,
    handicap_index: 22.3,
    preferred_play_times: 'Weekday afternoons',
    play_frequency: 'Twice a month',
    open_to_golf_travel: false,
    family_golfers: null,
    profile_visible: true,
    show_handicap: false,
    updated_at: '2024-03-15T00:00:00Z',
  },
}

// ---- Members ---------------------------------------------------
const buildMember = (
  id: string,
  firstName: string,
  lastName: string,
  email: string,
  isAdmin = false,
  createdAt = '2024-01-15T00:00:00Z',
): Member => ({
  id,
  ghl_contact_id: `ghl-${id}`,
  email,
  first_name: firstName,
  last_name: lastName,
  phone: '+1 619 555 0100',
  home_course_id: MOCK_COURSE_ID,
  membership_status: 'active',
  membership_start_date: '2024-01-15',
  referred_by: null,
  ghl_tags: ['avi member', 'avi member - active'],
  is_admin: isAdmin,
  created_at: createdAt,
  updated_at: createdAt,
})

export const mockMembers: MemberWithProfile[] = [
  { ...buildMember(MOCK_USER_ID, 'Fritz', 'Dumdum', 'fritz@rothbright.com', true), profile: profiles[MOCK_USER_ID] ?? null, home_course: mockCourse },
  { ...buildMember(MOCK_MEMBER_2_ID, 'James', 'Whitfield', 'james@whitfieldcapital.com', false, '2024-02-01T00:00:00Z'), profile: profiles[MOCK_MEMBER_2_ID] ?? null, home_course: mockCourse },
  { ...buildMember(MOCK_MEMBER_3_ID, 'Sarah', 'Chen', 'sarah@chenlaw.com', false, '2024-02-10T00:00:00Z'), profile: profiles[MOCK_MEMBER_3_ID] ?? null, home_course: mockCourse },
  { ...buildMember(MOCK_MEMBER_4_ID, 'Marcus', 'Rivera', 'marcus@coastalcre.com', false, '2024-03-01T00:00:00Z'), profile: profiles[MOCK_MEMBER_4_ID] ?? null, home_course: mockCourse },
  { ...buildMember(MOCK_MEMBER_5_ID, 'Diana', 'Okafor', 'diana@axiomhealth.com', false, '2024-03-15T00:00:00Z'), profile: profiles[MOCK_MEMBER_5_ID] ?? null, home_course: mockCourse },
]

export const mockCurrentUser = mockMembers[0] as MemberWithProfile

// ---- Course memberships ----------------------------------------
export const mockCourseMemberships: CourseMembership[] = [
  {
    id: 'cm-001',
    member_id: MOCK_USER_ID,
    course_id: MOCK_COURSE_ID,
    access_type: 'home',
    status: 'active',
    granted_by: null,
    valid_from: null,
    valid_until: null,
    created_at: '2024-01-15T00:00:00Z',
  },
]

// ---- Bookings --------------------------------------------------
const futureDate = (daysFromNow: number) => {
  const d = new Date()
  d.setDate(d.getDate() + daysFromNow)
  return d.toISOString().split('T')[0] ?? ''
}

export const mockBookings: Booking[] = [
  {
    id: 'booking-001',
    ghl_booking_id: 'ghl-book-001',
    ghl_opportunity_id: null,
    member_id: MOCK_USER_ID,
    course_id: MOCK_COURSE_ID,
    booking_date: futureDate(5),
    tee_time: '08:00:00',
    players: 1,
    guest_name: null,
    additional_players: [],
    status: 'tentative',
    amount_charged: 160,
    stripe_payment_id: null,
    focus_linkup_id: null,
    created_at: new Date().toISOString(),
  },
  {
    id: 'booking-002',
    ghl_booking_id: 'ghl-book-002',
    ghl_opportunity_id: null,
    member_id: MOCK_USER_ID,
    course_id: MOCK_COURSE_ID,
    booking_date: futureDate(18),
    tee_time: '07:30:00',
    players: 1,
    guest_name: null,
    additional_players: [],
    status: 'confirmed',
    amount_charged: 160,
    stripe_payment_id: 'pi_mock_002',
    focus_linkup_id: null,
    created_at: new Date().toISOString(),
  },
]

// ---- Announcements ---------------------------------------------
export const mockAnnouncements: Announcement[] = [
  {
    id: 'ann-001',
    course_id: MOCK_COURSE_ID,
    author_id: MOCK_USER_ID,
    type: 'new_member',
    title: 'Welcome Diana Okafor!',
    body: 'Please join us in welcoming Diana Okafor, CEO of Axiom Health. Diana brings deep expertise in healthcare technology. She is looking to connect with MedTech investors and distribution partners.',
    metadata: {},
    status: 'published',
    reviewed_by: null,
    published_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
    image_url: null,
    video_url: null,
    media_urls: [],
    focus_linkup_categories: [],
    created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'ann-002',
    course_id: MOCK_COURSE_ID,
    author_id: MOCK_MEMBER_4_ID,
    type: 'booking',
    title: 'Marcus Rivera booked a round for ' + new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
    body: 'Marcus Rivera has booked a tee time at Park Hyatt Aviara. Reach out to join or connect.',
    metadata: {},
    status: 'published',
    reviewed_by: null,
    published_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
    image_url: null,
    video_url: null,
    media_urls: [],
    focus_linkup_categories: [],
    created_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: 'ann-003',
    course_id: MOCK_COURSE_ID,
    author_id: MOCK_USER_ID,
    type: 'admin_broadcast',
    title: 'Reminder: Guest policy',
    body: 'Members are reminded that each member is permitted one non-member guest per calendar month. All guests must be registered at time of booking.',
    metadata: {},
    status: 'published',
    reviewed_by: null,
    published_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    image_url: null,
    video_url: null,
    media_urls: [],
    focus_linkup_categories: [],
    created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  },
]

// ---- Promotions ------------------------------------------------
export const mockPromotions: Promotion[] = [
  {
    id: 'promo-001',
    course_id: null,
    title: 'Complimentary Golf Cart Upgrade',
    description: 'Present your LinkUp Golf membership card at the pro shop to receive a complimentary premium cart upgrade on your next round. Valid through end of season.',
    partner_name: 'Park Hyatt Aviara',
    badge_label: 'Member Exclusive',
    expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0] ?? '',
    cta_label: 'Claim Offer',
    cta_url: null,
    active: true,
    sort_order: 1,
    image_url: null,
    video_url: null,
    media_urls: [],
    created_at: '2024-01-01T00:00:00Z',
  },
  {
    id: 'promo-002',
    course_id: null,
    title: '20% Off at Argyle Restaurant',
    description: 'LinkUp Golf members receive 20% off their total bill at Argyle, Park Hyatt Aviara\'s signature restaurant. Valid for parties up to six.',
    partner_name: 'Argyle at Aviara',
    badge_label: 'Dining Benefit',
    expires_at: null,
    cta_label: 'Reserve a Table',
    cta_url: null,
    active: true,
    sort_order: 2,
    image_url: null,
    video_url: null,
    media_urls: [],
    created_at: '2024-01-01T00:00:00Z',
  },
]

// ---- Conversations & Messages ----------------------------------
export const mockConversations: Conversation[] = [
  {
    id: 'conv-001',
    course_id: MOCK_COURSE_ID,
    type: 'direct',
    name: null,
    created_by: MOCK_USER_ID,
    created_at: '2024-03-01T10:00:00Z',
    updated_at: '2024-03-01T11:00:00Z',
  },
  {
    id: 'conv-002',
    course_id: MOCK_COURSE_ID,
    type: 'direct',
    name: null,
    created_by: MOCK_MEMBER_4_ID,
    created_at: '2024-03-05T09:00:00Z',
    updated_at: '2024-03-05T09:15:00Z',
  },
]

export const mockParticipants: ConversationParticipant[] = [
  { id: 'cp-001', conversation_id: 'conv-001', member_id: MOCK_USER_ID, joined_at: '2024-03-01T10:00:00Z', last_read_at: '2024-03-01T11:00:00Z', status: 'active' },
  { id: 'cp-002', conversation_id: 'conv-001', member_id: MOCK_MEMBER_2_ID, joined_at: '2024-03-01T10:00:00Z', last_read_at: null, status: 'active' },
  { id: 'cp-003', conversation_id: 'conv-002', member_id: MOCK_USER_ID, joined_at: '2024-03-05T09:00:00Z', last_read_at: '2024-03-05T10:00:00Z', status: 'active' },
  { id: 'cp-004', conversation_id: 'conv-002', member_id: MOCK_MEMBER_4_ID, joined_at: '2024-03-05T09:00:00Z', last_read_at: null, status: 'active' },
]

export const mockMessages: Message[] = [
  { id: 'msg-001', conversation_id: 'conv-001', sender_id: MOCK_MEMBER_2_ID, body: 'Hey Fritz, great meeting you at Aviara last week. Would love to connect on a couple of deal introductions.', created_at: '2024-03-01T10:30:00Z', edited_at: null, deleted_at: null },
  { id: 'msg-002', conversation_id: 'conv-001', sender_id: MOCK_USER_ID, body: 'Likewise James! Absolutely, let\'s set up a call. I have a few companies that could be a great fit for your portfolio.', created_at: '2024-03-01T11:00:00Z', edited_at: null, deleted_at: null },
  { id: 'msg-003', conversation_id: 'conv-002', sender_id: MOCK_MEMBER_4_ID, body: 'Fritz, I have a great NNN retail asset coming to market next week — off-market before it goes public. Thought of you immediately.', created_at: '2024-03-05T09:15:00Z', edited_at: null, deleted_at: null },
]

// ---- Referrals -------------------------------------------------
export const mockReferrals: Referral[] = [
  {
    id: 'ref-001',
    referring_member_id: MOCK_USER_ID,
    referred_email: 'tom.nguyen@example.com',
    referred_member_id: null,
    status: 'interviewed',
    first_round_free: true,
    joint_round_booked: false,
    joint_round_booking_id: null,
    created_at: '2024-03-10T00:00:00Z',
    updated_at: '2024-03-12T00:00:00Z',
  },
]

// ---- Focus LinkUps ---------------------------------------------
export const mockFocusLinkups: FocusLinkup[] = [
  {
    id: 'fl-001',
    course_id: MOCK_COURSE_ID,
    title: 'Real Estate & Capital Providers LinkUp',
    description: 'A curated round connecting real estate operators with capital providers. Limited to 8 members.',
    focus_date: futureDate(14),
    tee_time: '07:00:00',
    industry_focus: ['Real Estate', 'Capital Provider'],
    notification_sent_2w: false,
    notification_sent_1w: false,
    created_at: '2024-03-01T00:00:00Z',
  },
  {
    id: 'fl-002',
    course_id: MOCK_COURSE_ID,
    title: 'Healthcare & Technology LinkUp',
    description: 'Connecting healthcare operators with technology partners and investors.',
    focus_date: futureDate(28),
    tee_time: '08:00:00',
    industry_focus: ['Healthcare / Life Sciences', 'Technology'],
    notification_sent_2w: false,
    notification_sent_1w: false,
    created_at: '2024-03-05T00:00:00Z',
  },
]

// ---- Guest access requests ------------------------------------
export const mockGuestAccessRequests: GuestAccessRequest[] = [
  {
    id: 'gar-001',
    requesting_member_id: MOCK_USER_ID,
    target_course_id: MOCK_COURSE_ID,
    reason: 'Visiting San Diego for a conference next month.',
    visit_from: futureDate(30),
    visit_until: futureDate(33),
    location_verified: false,
    status: 'pending',
    reviewed_by: null,
    created_at: new Date().toISOString(),
  },
]

// ---- Booking slots (for /api/bookings/create GET) -------------
export const mockBookingSlots = [
  { startTime: `${futureDate(5)}T07:00:00`, endTime: `${futureDate(5)}T07:10:00`, available: true, spotsOpen: 3 },
  { startTime: `${futureDate(5)}T07:10:00`, endTime: `${futureDate(5)}T07:20:00`, available: true, spotsOpen: 4 },
  { startTime: `${futureDate(5)}T08:00:00`, endTime: `${futureDate(5)}T08:10:00`, available: false, spotsOpen: 0 },
  { startTime: `${futureDate(5)}T08:30:00`, endTime: `${futureDate(5)}T08:40:00`, available: true, spotsOpen: 2 },
  { startTime: `${futureDate(5)}T13:00:00`, endTime: `${futureDate(5)}T13:10:00`, available: true, spotsOpen: 4 },
  { startTime: `${futureDate(5)}T14:00:00`, endTime: `${futureDate(5)}T14:10:00`, available: true, spotsOpen: 1 },
]
