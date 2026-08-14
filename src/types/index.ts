// ============================================================
// LinkUp Golf — Core TypeScript Types
// ============================================================

// ---- Enums --------------------------------------------------

export type MembershipStatus = 'active' | 'waitlist' | 'pending' | 'suspended' | 'cancelled' | 'non_member'
export type AccessType = 'home' | 'guest'
export type CourseMembershipStatus = 'active' | 'pending' | 'expired'
export type BookingStatus =
  | 'awaiting_approval'
  | 'tentative'
  | 'availability_confirmed'
  | 'payment_confirmed'
  | 'confirmed'
  | 'pending'
  | 'cancelled'
  | 'waitlist'
export type AnnouncementType =
  | 'member_event'
  | 'new_course'
  | 'admin_broadcast'
  | 'promotion'
export type ModerationStatus = 'pending_review' | 'published' | 'rejected'
export type ReferralStatus = 'pending' | 'interviewed' | 'approved' | 'declined' | 'joined'
export type GuestAccessStatus = 'pending' | 'approved' | 'denied' | 'revoked'
export type ConversationType = 'direct' | 'group'
export type ParticipantRole = 'member' | 'moderator'
export type ParticipantStatus = 'pending' | 'active'
export type NotificationType =
  | 'new_member'
  | 'booking'
  | 'booking_invite'
  | 'payment_ready'
  | 'visiting_member'
  | 'message'
  | 'group_invite'
  | 'focus_linkup'
  | 'play_suggestion'
  | 'guest_access'
  | 'referral'
  | 'member_event'
  | 'host_application'
  | 'hosted_event'
  | 'host_credit'
  | 'test'
  | 'general'
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

export type CourseApprovalStatus = 'pending' | 'active' | 'rejected' | 'archived'

export interface Course {
  id: string
  name: string
  slug: string
  logo_url: string
  city: string
  state: string
  country: string
  address: string | null
  phone: string | null
  map_link: string | null
  access_tag: string
  max_members: number
  max_rounds_per_month: number
  reserved_rounds: number
  timezone: string
  active: boolean
  created_at: string

  // GHL booking calendar
  ghl_calendar_id: string | null
  ghl_calendar_user_id: string | null

  // Per-course booking config
  cost_per_player: number | null
  booking_rules: string | null
  required_tags: string[]
  meeting_interval_mins: number
  meeting_duration_mins: number
  min_scheduling_notice_mins: number
  date_range_days: number
  pre_buffer_mins: number
  post_buffer_mins: number
  seats_per_class: number | null
  // Max total bookings allowed at this course per date (across all tee times).
  max_players_per_day: number
  // When true, this course's bookable tee times are admin-curated per date
  // (see CustomSlot / course_custom_slots) instead of coming live from GHL.
  custom_slots_enabled: boolean

  // Optional description shown in the admin and used as the GHL group description
  description: string | null

  // Website shown to members (any valid URL, optional) — labelled "Website" in the admin UI
  booking_url: string | null

  // Payment link members are sent to for confirmed bookings — required per course
  payment_url: string | null

  // GHL Calendar Group for this course (auto-created on course creation)
  ghl_group_id: string | null

  // Manual display order (admin-controlled); lower sorts first, null sorts last
  sort_order: number | null

  // Approval workflow
  approval_status: CourseApprovalStatus
  requested_by: string | null
  reviewed_by: string | null
  rejection_reason: string | null
  requester?: { first_name: string; last_name: string } | null
}

// One admin-curated tee time on a specific date for a course whose
// custom_slots_enabled is true. `source` records whether the time was
// selected from the GHL calendar or added by hand.
export interface CustomSlot {
  id: string
  course_id: string
  slot_date: string   // YYYY-MM-DD
  tee_time: string    // HH:mm[:ss]
  seats: number
  source: 'ghl' | 'custom'
  created_at: string
  updated_at: string
}

export interface Member {
  id: string
  ghl_contact_id: string
  email: string
  first_name: string
  last_name: string
  phone: string | null
  /** Null for a non-member (a referral partner / host with no golf membership). */
  home_course_id: string | null
  membership_status: MembershipStatus
  membership_start_date: string | null
  referred_by: string | null
  ghl_tags: string[]
  is_admin: boolean
  warning_count?: number
  suspended_until?: string | null
  messaging_muted_until?: string | null
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
  /** Non-profits this member supports, max 3. Never null — the column defaults to '{}'. */
  nonprofits: string[]
  linkedin_url: string | null
  handicap_index: number | null
  preferred_play_times: string | null
  play_frequency: string | null
  open_to_golf_travel: boolean
  family_golfers: string | null
  profile_visible: boolean
  show_handicap: boolean
  text_size: number
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
  memberId?: string
  /** True when this player was added as a non-member invite (no member account). */
  isNonMember?: boolean
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
  player_member_id: string | null
  additional_players: AdditionalPlayer[]
  status: BookingStatus
  amount_charged: number
  stripe_payment_id: string | null
  focus_linkup_id: string | null
  dinner_rsvp?: 'yes' | 'no' | 'maybe' | null
  admin_notes?: string | null
  created_at: string
  booker_name?: string | null
  course?: {
    name: string
    city: string
    state: string
    payment_url: string | null
    timezone: string
    /** Round length, used to work out when the round finished. */
    meeting_duration_mins?: number | null
  } | null
}

// Post-round satisfaction response — one per booking, collected by the survey
// prompt shortly after the round is scheduled to finish.
export interface BookingSurvey {
  id: string
  booking_id: string
  member_id: string
  course_id: string
  /** 1–5 stars. Always answered; the comment is the optional part. */
  rating: number
  /** False when the member ticked "I didn't make it" — excluded from averages. */
  attended: boolean
  comment: string | null
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

// ---- Referral partners --------------------------------------

export type ReferralPartnerLinkStatus = 'linked' | 'converted'

/**
 * How referral commission is settled.
 *
 * 'credit' is the default: the payout lands in the partner's member credit
 * wallet, spendable on golf once they hold a membership. cash and coupon remain
 * for a partner with no LinkUp account — they have no wallet to credit.
 */
export type PayoutMethod = 'credit' | 'cash' | 'coupon'

export interface ReferralPartner {
  id: string
  name: string
  code: string
  percentage: number
  /** Last day the commission percentage is honoured (YYYY-MM-DD). Null = no expiry. */
  ends_at: string | null
  /** How commission is paid out. */
  payout_method: PayoutMethod
  /** Owning member, when the partner is a member rather than an external affiliate. */
  member_id: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export type ReferralPartnerSubmissionStatus = 'pending' | 'imported' | 'rejected'
export type ReferralSubmissionEntryStatus = 'pending' | 'imported' | 'skipped'

/** A batch of referrals a partner submitted for an admin to import. */
export interface ReferralPartnerSubmission {
  id: string
  referral_partner_id: string
  status: ReferralPartnerSubmissionStatus
  note: string | null
  entry_count: number
  imported_count: number | null
  /** Original filename of the uploaded CSV. */
  csv_filename: string | null
  /** Commission rate at import time — an audit record, not the commission source. */
  applied_percentage: number | null
  rejection_reason: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  // Enriched in API responses
  entries?: ReferralSubmissionEntry[]
  partner?: { id: string; name: string; code: string } | null
}

export interface ReferralSubmissionEntry {
  id: string
  submission_id: string
  email: string
  name: string | null
  status: ReferralSubmissionEntryStatus
  /** Why an entry didn't import (e.g. already attributed to another partner). */
  skip_reason: string | null
  link_id: string | null
  created_at: string
}

export type ReferralPartnerApplicationStatus = 'pending' | 'approved' | 'rejected'

export interface ReferralPartnerApplication {
  id: string
  member_id: string
  /** Referral name the applicant proposes to operate under. */
  name: string | null
  /** The applicant's pitch — why they'd be a good partner. */
  description: string
  status: ReferralPartnerApplicationStatus
  partner_id: string | null
  rejection_reason: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  // Enriched (present when joined to the member row in API responses)
  member?: { first_name: string; last_name: string; email: string } | null
}

export interface ReferralPartnerLink {
  id: string
  referral_partner_id: string
  member_id: string | null
  email: string
  ghl_contact_id: string | null
  status: ReferralPartnerLinkStatus
  converted_at: string | null
  created_at: string
  updated_at: string
  // Enriched (present when joined to the member row in API responses)
  member?: { first_name: string; last_name: string; email: string; membership_status: string } | null
}

// Naming note: a "referred" contact is anyone attributed to the partner; an
// "active" one has since become a paying member. The link row's DB status
// values ('linked' / 'converted') are the historical spelling of the same two
// states — the UI and these counters use the member-facing wording.
export interface ReferralPartnerStats {
  referredCount: number
  memberCount: number
  nonMemberCount: number
  activeCount: number
  commissionOwed: number
}

// ---- Hosts --------------------------------------------------

export type HostStatus = 'active' | 'suspended'

/** How the host role was granted. 'application' is the reviewed path. */
export type HostSource = 'application' | 'ghl_tag' | 'admin'

/** A member with the host role — an active row's existence grants /host. */
export interface Host {
  id: string
  member_id: string
  name: string
  status: HostStatus
  /**
   * True = may host at any bookable course. False = only their host_venues rows.
   * Explicit rather than inferred from having no venue rows, which used to mean
   * an empty grant read as unrestricted access.
   */
  venues_unrestricted: boolean
  source: HostSource
  created_by: string | null
  created_at: string
  updated_at: string
}

export type HostApplicationStatus = 'pending' | 'approved' | 'rejected'

/**
 * A round proposed on a host application — the dates/spots/pricing half of the
 * "how it works" flow. Becomes a real HostedEvent on approval.
 */
export interface HostApplicationEvent {
  id: string
  application_id: string
  course_id: string
  event_date: string
  /** Free text, or null when there's no fixed tee time. */
  tee_time: string | null
  total_spots: number
  member_guest_rate: number
  dinner: boolean
  /** Set once approval turned this into a live event. */
  hosted_event_id: string | null
  created_at: string
  // Enriched in API responses
  course?: { id: string; name: string; city?: string | null; approval_status?: string } | null
}

/** What the applicant submits per proposed round (no ids yet). */
export type HostApplicationEventInput = Pick<
  HostApplicationEvent,
  'course_id' | 'event_date' | 'tee_time' | 'total_spots' | 'member_guest_rate' | 'dinner'
>

export interface HostApplication {
  id: string
  member_id: string
  /** Host name the applicant proposes to operate under. */
  name: string | null
  /** The applicant's pitch — the kind of events they'd run. */
  description: string
  /** The course ids the applicant wants to host at. */
  requested_course_ids: string[]
  status: HostApplicationStatus
  host_id: string | null
  rejection_reason: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
  updated_at: string
  // Enriched (present when joined to the member row in API responses)
  member?: { first_name: string; last_name: string; email: string } | null
  /** Rounds the applicant proposed alongside the venues. */
  events?: HostApplicationEvent[]
}

export type HostedEventStatus =
  | 'upcoming'
  | 'completed'
  | 'cancelled'
  | 'pending_credit_approval'
  | 'credits_awarded'

export interface HostedEvent {
  id: string
  host_id: string
  course_id: string
  event_date: string
  /** HH:MM[:SS], or null when the event has no fixed tee time. */
  tee_time: string | null
  total_spots: number
  member_guest_rate: number
  /** Whether dinner is included with the event. */
  dinner: boolean
  status: HostedEventStatus
  cancellation_reason: string | null
  /** Why an admin sent the event back for changes. */
  rejection_reason: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  /** Set when the event was listed from one of the host's existing bookings. */
  source_booking_id: string | null
  created_at: string
  updated_at: string
  // Enriched in API responses
  /** member_guest_rate + HOST_MEMBER_PRICE_MARKUP_USD. */
  member_price?: number
  filled_spots?: number
  remaining_spots?: number
  course?: { id: string; name: string; city?: string | null } | null
  host?: { id: string; name: string; member?: { first_name: string; last_name: string } | null } | null
  proofs?: HostedEventProof[]
  /** True when the requesting member holds an active reservation. */
  is_registered?: boolean
}

/**
 * An active upcoming booking a host can take on and run as a hosted event —
 * any member's booking, not only the host's own. A booking "group" is several
 * bookings rows sharing member/created_at/date/tee time — one row per seat —
 * so `seats` is that row count.
 */
export interface HostBookingOption {
  /** The representative bookings row the event will link to. */
  id: string
  course_id: string
  course_name: string | null
  /** The member who made the booking. */
  booked_by: string | null
  booking_date: string
  tee_time: string
  seats: number
  /** True when this booking is already listed as a live hosted event. */
  already_listed: boolean
}

export type HostedEventRegistrationStatus = 'reserved' | 'cancelled'

export interface HostedEventRegistration {
  id: string
  hosted_event_id: string
  member_id: string
  status: HostedEventRegistrationStatus
  created_at: string
  // Enriched
  member?: { first_name: string; last_name: string; avatar_url?: string | null } | null
}

export interface HostedEventProof {
  id: string
  hosted_event_id: string
  /** Supabase Storage URL — what the app renders. */
  image_url: string
  /** GHL's handle for the mirrored copy; null when the mirror didn't land. */
  ghl_media_id?: string | null
  /** URL of the GHL copy; null when the mirror didn't land. */
  ghl_media_url?: string | null
  uploaded_by: string | null
  created_at: string
}

export type CreditKind = 'earned' | 'redeemed' | 'adjusted'

/** What a redemption buys. Credit is spendable on either. */
export type CreditPurpose = 'golf' | 'membership'

/**
 * One movement in a member's credit wallet. Append-only and signed: the balance
 * is the sum of `amount` across a member's rows.
 */
export interface CreditEntry {
  id: string
  /** Whose wallet. What a balance is summed over. */
  member_id: string
  /** Set when the credit was earned by hosting; null for other sources. */
  host_id: string | null
  event_id: string | null
  kind: CreditKind
  amount: number
  /** Set on redemptions made after the purpose became required. */
  purpose: CreditPurpose | null
  note: string | null
  created_by: string | null
  created_at: string
}

export interface CreditSummary {
  earned: number
  redeemed: number
  balance: number
}

export interface HostStats {
  upcomingCount: number
  completedCount: number
  cancelledCount: number
  totalEvents: number
  credits: CreditSummary
}

export type ReferralPartnerWithStats = ReferralPartner & ReferralPartnerStats

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
  is_pinned: boolean
  created_at: string
}

export interface MemberEvent {
  id: string
  course_id: string
  organizer_id: string
  title: string
  description: string
  event_date: string
  event_end_date: string | null
  event_time: string
  location: string
  external_url: string | null
  max_attendees: number | null
  status: ModerationStatus
  reviewed_by: string | null
  rejection_reason: string | null
  created_at: string
  organizer?: { first_name: string; last_name: string } | null
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

// ---- Notification Log ---------------------------------------

export interface NotificationLog {
  id: string
  member_id: string
  type: NotificationType
  title: string
  body: string
  data: Record<string, unknown> | null
  url: string | null
  read_at: string | null
  created_at: string
}
