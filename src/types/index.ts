// ============================================================
// LinkUp Golf — Core TypeScript Types
// ============================================================

// ---- Enums --------------------------------------------------

export type MembershipStatus = 'active' | 'waitlist' | 'pending' | 'suspended' | 'cancelled'
export type AccessType = 'home' | 'guest'
export type CourseMembershipStatus = 'active' | 'pending' | 'expired'
export type BookingStatus =
  | 'tentative'
  | 'availability_confirmed'
  | 'payment_confirmed'
  | 'confirmed'
  | 'pending'
  | 'cancelled'
  | 'waitlist'
export type AnnouncementType =
  | 'new_member'
  | 'booking'
  | 'visiting_member'
  | 'member_event'
  | 'admin_broadcast'
  | 'focus_linkup'
export type ModerationStatus = 'pending_review' | 'published' | 'rejected'
export type ReferralStatus = 'pending' | 'interviewed' | 'approved' | 'declined' | 'joined'
export type GuestAccessStatus = 'pending' | 'approved' | 'denied' | 'revoked'
export type ConversationType = 'direct' | 'group'
export type ParticipantRole = 'member' | 'moderator'
export type ParticipantStatus = 'pending' | 'active'
export type RSVPStatus = 'attending' | 'maybe' | 'declined'

export type IndustryCategory =
  | 'Business Owner / Founder'
  | 'Professional Services (Legal)'
  | 'Professional Services (Accounting)'
  | 'Professional Services (Consulting)'
  | 'Capital Provider'
  | 'Insurance'
  | 'Business Software'
  | 'Business Services'
  | 'HR & Recruitment'
  | 'Real Estate'
  | 'Healthcare / Life Sciences'
  | 'Financial Services'
  | 'Technology'
  | 'Other'

export const INDUSTRY_CATEGORIES: IndustryCategory[] = [
  'Business Owner / Founder',
  'Professional Services (Legal)',
  'Professional Services (Accounting)',
  'Professional Services (Consulting)',
  'Capital Provider',
  'Insurance',
  'Business Software',
  'Business Services',
  'HR & Recruitment',
  'Real Estate',
  'Healthcare / Life Sciences',
  'Financial Services',
  'Technology',
  'Other',
]

// ---- Database Row Types ------------------------------------
// These match the Supabase table schemas exactly

export interface Course {
  id: string
  name: string
  slug: string
  city: string
  state: string
  country: string
  access_tag: string
  max_members: number
  max_rounds_per_month: number
  reserved_rounds: number
  timezone: string
  active: boolean
  created_at: string
}

export interface Member {
  id: string
  ghl_contact_id: string
  email: string
  first_name: string
  last_name: string
  phone: string | null
  home_course_id: string
  membership_status: MembershipStatus
  membership_start_date: string | null
  referred_by: string | null
  ghl_tags: string[]
  is_admin: boolean
  warning_count?: number
  suspended_until?: string | null
  last_sign_in?: string | null
  created_at: string
  updated_at: string
}

export interface MemberProfile {
  id: string
  display_name: string
  avatar_url: string | null
  business_name: string | null
  business_description: string | null
  role_title: string | null
  industry_category: IndustryCategory | null
  value_offered: string | null
  value_sought: string | null
  non_golf_hobbies: string | null
  linkedin_url: string | null
  handicap_index: number | null
  preferred_play_times: string | null
  play_frequency: string | null
  open_to_golf_travel: boolean
  family_golfers: string | null
  profile_visible: boolean
  show_handicap: boolean
  updated_at: string
}

export interface CourseMembership {
  id: string
  member_id: string
  course_id: string
  access_type: AccessType
  status: CourseMembershipStatus
  granted_by: string | null
  valid_from: string | null
  valid_until: string | null
  created_at: string
}

export interface AdditionalPlayer {
  firstName: string
  lastName: string
  mobile: string
  email: string
}

export interface Booking {
  id: string
  ghl_booking_id: string | null
  ghl_opportunity_id: string | null
  member_id: string
  course_id: string
  booking_date: string
  tee_time: string
  players: number
  guest_name: string | null
  additional_players: AdditionalPlayer[]
  status: BookingStatus
  amount_charged: number
  stripe_payment_id: string | null
  focus_linkup_id: string | null
  admin_notes?: string | null
  created_at: string
}

export interface PlayHistory {
  id: string
  booking_id: string
  member_id: string
  played_with: string[]
  course_id: string
  played_date: string
  created_at: string
}

export interface Referral {
  id: string
  referring_member_id: string
  referred_email: string
  referred_member_id: string | null
  status: ReferralStatus
  first_round_free: boolean
  joint_round_booked: boolean
  joint_round_booking_id: string | null
  created_at: string
  updated_at: string
}

export interface Conversation {
  id: string
  course_id: string
  type: ConversationType
  name: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface ConversationParticipant {
  id: string
  conversation_id: string
  member_id: string
  joined_at: string
  last_read_at: string | null
  status: ParticipantStatus
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  created_at: string
  edited_at: string | null
  deleted_at: string | null
}

export interface Announcement {
  id: string
  course_id: string
  author_id: string
  type: AnnouncementType
  title: string
  body: string
  metadata: Record<string, unknown>
  status: ModerationStatus
  reviewed_by: string | null
  published_at: string | null
  image_url: string | null
  video_url: string | null
  media_urls: string[]
  focus_linkup_categories: string[]
  created_at: string
}

export interface MemberEvent {
  id: string
  course_id: string
  organizer_id: string
  title: string
  description: string
  event_date: string
  event_time: string
  location: string
  external_url: string | null
  max_attendees: number | null
  status: ModerationStatus
  reviewed_by: string | null
  created_at: string
}

export interface MemberEventRSVP {
  id: string
  event_id: string
  member_id: string
  status: RSVPStatus
  created_at: string
}

export interface FocusLinkup {
  id: string
  course_id: string
  title: string
  description: string
  focus_date: string
  tee_time: string
  industry_focus: IndustryCategory[]
  notification_sent_2w: boolean
  notification_sent_1w: boolean
  created_at: string
}

export interface FocusLinkupSubscription {
  id: string
  member_id: string
  industry_focus: IndustryCategory
  custom_label: string | null
  status: 'pending' | 'approved' | 'declined'
  reviewed_at: string | null
  reviewed_by: string | null
  created_at: string
}

export interface Promotion {
  id: string
  course_id: string | null
  title: string
  description: string
  partner_name: string
  badge_label: string
  expires_at: string | null
  cta_label: string
  cta_url: string | null
  active: boolean
  sort_order: number
  image_url: string | null
  video_url: string | null
  media_urls: string[]
  created_at: string
}

export interface AdminAuditLog {
  id: string
  admin_id: string
  action: string
  target_type: string
  target_id: string
  payload: Record<string, unknown>
  created_at: string
}

export interface GuestAccessRequest {
  id: string
  requesting_member_id: string
  target_course_id: string
  reason: string
  visit_from: string
  visit_until: string
  location_verified: boolean
  status: GuestAccessStatus
  reviewed_by: string | null
  created_at: string
}

export interface InviteToken {
  id: string
  token: string
  ghl_contact_id: string
  email: string
  course_id: string
  used: boolean
  expires_at: string
  created_at: string
}

// ---- Joined / Enriched Types --------------------------------
// For UI use — members with their profiles attached

export interface MemberWithProfile extends Member {
  profile: MemberProfile | null
  home_course: Course | null
}

// Minimal member shape returned by messaging API joins (avatar only from profile)
export interface MemberSummary {
  id: string
  first_name: string
  last_name: string
  profile: { avatar_url: string | null } | null
}

export interface MessageWithSender extends Message {
  sender: MemberSummary
}

export interface OptimisticMessage extends MessageWithSender {
  pending?: boolean
  failed?: boolean
  tempId?: string
}

export interface ConversationWithDetails extends Conversation {
  participants: Array<{
    member: MemberSummary
    last_read_at: string | null
    role: ParticipantRole
    status: ParticipantStatus
  }>
  last_message: MessageWithSender | null
  unread_count: number
  my_status: ParticipantStatus
}

/** Full participant shape returned by GET /api/conversations/[id]/participants */
export interface GroupParticipant {
  member: MemberSummary
  role: ParticipantRole
  joined_at: string
  status: ParticipantStatus
}

export interface AnnouncementWithAuthor extends Announcement {
  author: Pick<MemberWithProfile, 'id' | 'first_name' | 'last_name' | 'profile'>
}

// ---- GHL API Types ------------------------------------------

export interface GHLContact {
  id: string
  email: string
  firstName: string
  lastName: string
  phone: string
  tags: string[]
  customFields: Array<{ id: string; value: string }>
}

export interface GHLBookingSlot {
  startTime: string
  endTime: string
  available: boolean
  slots?: number
  spotsOpen?: number
}

export interface GHLCalendarEvent {
  id: string
  calendarId: string
  startTime: string
  endTime: string
  title: string
  status: string
}

// ---- API Response Types -------------------------------------

export interface ApiResponse<T> {
  data: T | null
  error: string | null
}

export interface PaginatedResponse<T> {
  data: T[]
  count: number
  page: number
  pageSize: number
  hasMore: boolean
}

// ---- Auth / Session -----------------------------------------

export interface SessionUser {
  id: string
  email: string
  member: MemberWithProfile
  isAdmin: boolean
  activeCourseIds: string[]
}
