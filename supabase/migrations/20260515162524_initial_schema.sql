-- ============================================================
-- LinkUp Golf — Supabase Database Schema
-- Run this in the Supabase SQL editor to set up the database.
-- Run in order — dependencies must exist before foreign keys.
-- ============================================================

-- No extensions needed: gen_random_uuid() is built into PostgreSQL 13+
-- Token generation uses two concatenated UUIDs (64 hex chars, 256-bit entropy)

-- ============================================================
-- ENUMS
-- ============================================================

create type membership_status as enum ('active', 'waitlist', 'pending', 'suspended', 'cancelled');
create type access_type as enum ('home', 'guest');
create type course_membership_status as enum ('active', 'pending', 'expired');
create type booking_status as enum ('confirmed', 'pending', 'cancelled', 'waitlist');
create type announcement_type as enum (
  'new_member', 'booking', 'visiting_member',
  'member_event', 'admin_broadcast', 'focus_linkup'
);
create type moderation_status as enum ('pending_review', 'published', 'rejected');
create type referral_status as enum ('pending', 'interviewed', 'approved', 'declined', 'joined');
create type guest_access_status as enum ('pending', 'approved', 'denied');
create type conversation_type as enum ('direct', 'group');
create type rsvp_status as enum ('attending', 'maybe', 'declined');

-- ============================================================
-- TABLE: courses
-- ============================================================

create table courses (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  slug                 text not null unique,
  city                 text not null,
  state                text not null,
  country              text not null default 'US',
  access_tag           text not null,     -- GHL tag, e.g. "avi-active"
  max_members          integer not null default 200,
  max_rounds_per_month integer not null default 300,
  reserved_rounds      integer not null default 100,
  timezone             text not null default 'America/Los_Angeles',
  active               boolean not null default true,
  created_at           timestamptz not null default now()
);

-- Seed the first course
insert into courses (name, slug, city, state, access_tag, max_members, max_rounds_per_month, reserved_rounds, timezone)
values ('Park Hyatt Aviara Golf Club', 'aviara', 'Carlsbad', 'CA', 'avi-active', 200, 300, 100, 'America/Los_Angeles');

-- ============================================================
-- TABLE: members
-- (References auth.users which Supabase manages)
-- ============================================================

create table members (
  id                   uuid primary key references auth.users(id) on delete cascade,
  ghl_contact_id       text not null unique,
  email                text not null unique,
  first_name           text not null,
  last_name            text not null,
  phone                text,
  home_course_id       uuid not null references courses(id),
  membership_status    membership_status not null default 'pending',
  membership_start_date date,
  referred_by          uuid references members(id),
  ghl_tags             jsonb not null default '[]',
  is_admin             boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index members_email_idx on members(email);
create index members_home_course_idx on members(home_course_id);
create index members_ghl_contact_idx on members(ghl_contact_id);

-- ============================================================
-- TABLE: member_profiles
-- ============================================================

create table member_profiles (
  id                   uuid primary key references members(id) on delete cascade,
  display_name         text,
  avatar_url           text,
  business_name        text,
  business_description text,
  role_title           text,
  industry_category    text,
  value_offered        text,
  value_sought         text,
  non_golf_hobbies     text,
  handicap_index       decimal(4,1),
  preferred_play_times text,
  play_frequency       text,
  open_to_golf_travel  boolean not null default false,
  family_golfers       text,
  profile_visible      boolean not null default true,
  show_handicap        boolean not null default false,
  updated_at           timestamptz not null default now()
);

-- ============================================================
-- TABLE: course_memberships
-- ============================================================

create table course_memberships (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references members(id) on delete cascade,
  course_id    uuid not null references courses(id) on delete cascade,
  access_type  access_type not null default 'home',
  status       course_membership_status not null default 'active',
  granted_by   uuid references members(id),
  valid_from   date,
  valid_until  date,
  created_at   timestamptz not null default now(),
  unique(member_id, course_id, access_type)
);

create index course_memberships_member_idx on course_memberships(member_id);
create index course_memberships_course_idx on course_memberships(course_id);

-- ============================================================
-- TABLE: invite_tokens
-- ============================================================

create table invite_tokens (
  id              uuid primary key default gen_random_uuid(),
  token           text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  ghl_contact_id  text not null,
  email           text not null,
  course_id       uuid not null references courses(id),
  used            boolean not null default false,
  expires_at      timestamptz not null default (now() + interval '7 days'),
  created_at      timestamptz not null default now()
);

-- ============================================================
-- TABLE: bookings
-- ============================================================

create table bookings (
  id                uuid primary key default gen_random_uuid(),
  ghl_booking_id    text unique,
  member_id         uuid not null references members(id) on delete cascade,
  course_id         uuid not null references courses(id),
  booking_date      date not null,
  tee_time          time not null,
  players           integer not null default 1 check (players between 1 and 4),
  guest_name        text,
  status            booking_status not null default 'pending',
  amount_charged    decimal(10,2) not null default 0,
  stripe_payment_id text,
  focus_linkup_id   uuid,
  created_at        timestamptz not null default now()
);

create index bookings_member_idx on bookings(member_id);
create index bookings_course_date_idx on bookings(course_id, booking_date);

-- ============================================================
-- TABLE: play_history
-- ============================================================

create table play_history (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings(id) on delete cascade,
  member_id   uuid not null references members(id) on delete cascade,
  played_with uuid[] not null default '{}',
  course_id   uuid not null references courses(id),
  played_date date not null,
  created_at  timestamptz not null default now()
);

create index play_history_member_idx on play_history(member_id);

-- ============================================================
-- TABLE: referrals
-- ============================================================

create table referrals (
  id                        uuid primary key default gen_random_uuid(),
  referring_member_id       uuid not null references members(id),
  referred_email            text not null,
  referred_member_id        uuid references members(id),
  status                    referral_status not null default 'pending',
  first_round_free          boolean not null default true,
  joint_round_booked        boolean not null default false,
  joint_round_booking_id    uuid references bookings(id),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index referrals_referring_idx on referrals(referring_member_id);

-- ============================================================
-- TABLE: conversations
-- ============================================================

create table conversations (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses(id),
  type        conversation_type not null default 'direct',
  name        text,
  created_by  uuid not null references members(id),
  created_at  timestamptz not null default now()
);

create index conversations_course_idx on conversations(course_id);

-- ============================================================
-- TABLE: conversation_participants
-- ============================================================

create table conversation_participants (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  member_id        uuid not null references members(id) on delete cascade,
  joined_at        timestamptz not null default now(),
  last_read_at     timestamptz,
  unique(conversation_id, member_id)
);

create index participants_conversation_idx on conversation_participants(conversation_id);
create index participants_member_idx on conversation_participants(member_id);

-- ============================================================
-- TABLE: messages
-- ============================================================

create table messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references conversations(id) on delete cascade,
  sender_id        uuid not null references members(id),
  body             text not null,
  created_at       timestamptz not null default now(),
  edited_at        timestamptz,
  deleted_at       timestamptz
);

create index messages_conversation_idx on messages(conversation_id, created_at desc);

-- ============================================================
-- TABLE: announcements
-- ============================================================

create table announcements (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references courses(id),
  author_id    uuid not null references members(id),
  type         announcement_type not null,
  title        text not null,
  body         text not null,
  metadata     jsonb not null default '{}',
  status       moderation_status not null default 'pending_review',
  reviewed_by  uuid references members(id),
  published_at timestamptz,
  created_at   timestamptz not null default now()
);

create index announcements_course_idx on announcements(course_id, published_at desc);

-- ============================================================
-- TABLE: member_events
-- ============================================================

create table member_events (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references courses(id),
  organizer_id  uuid not null references members(id),
  title         text not null,
  description   text not null,
  event_date    date not null,
  event_time    time not null,
  location      text not null,
  external_url  text,
  max_attendees integer,
  status        moderation_status not null default 'pending_review',
  reviewed_by   uuid references members(id),
  created_at    timestamptz not null default now()
);

create index member_events_course_idx on member_events(course_id, event_date);

-- ============================================================
-- TABLE: member_event_rsvps
-- ============================================================

create table member_event_rsvps (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references member_events(id) on delete cascade,
  member_id  uuid not null references members(id) on delete cascade,
  status     rsvp_status not null default 'attending',
  created_at timestamptz not null default now(),
  unique(event_id, member_id)
);

-- ============================================================
-- TABLE: focus_linkups
-- ============================================================

create table focus_linkups (
  id                    uuid primary key default gen_random_uuid(),
  course_id             uuid not null references courses(id),
  title                 text not null,
  description           text not null,
  focus_date            date not null,
  tee_time              time not null,
  industry_focus        text[] not null default '{}',
  notification_sent_2w  boolean not null default false,
  notification_sent_1w  boolean not null default false,
  created_at            timestamptz not null default now()
);

create index focus_linkups_course_date_idx on focus_linkups(course_id, focus_date);

-- ============================================================
-- TABLE: focus_linkup_subscriptions
-- ============================================================

create table focus_linkup_subscriptions (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references members(id) on delete cascade,
  industry_focus  text not null,
  created_at      timestamptz not null default now(),
  unique(member_id, industry_focus)
);

create index focus_subscriptions_member_idx on focus_linkup_subscriptions(member_id);

-- ============================================================
-- TABLE: promotions
-- ============================================================

create table promotions (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid references courses(id),   -- null = all courses
  title        text not null,
  description  text not null,
  partner_name text not null,
  badge_label  text not null,
  expires_at   date,
  cta_label    text not null default 'Learn more',
  cta_url      text,
  active       boolean not null default true,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- TABLE: guest_access_requests
-- ============================================================

create table guest_access_requests (
  id                    uuid primary key default gen_random_uuid(),
  requesting_member_id  uuid not null references members(id),
  target_course_id      uuid not null references courses(id),
  reason                text not null,
  visit_from            date not null,
  visit_until           date not null,
  location_verified     boolean not null default false,
  status                guest_access_status not null default 'pending',
  reviewed_by           uuid references members(id),
  created_at            timestamptz not null default now()
);

-- ============================================================
-- TABLE: play_suggestions (tracks dismissed suggestions)
-- ============================================================

create table play_suggestions (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null references members(id) on delete cascade,
  suggested_id  uuid not null references members(id) on delete cascade,
  dismissed     boolean not null default false,
  dismissed_at  timestamptz,
  created_at    timestamptz not null default now(),
  unique(member_id, suggested_id)
);

-- ============================================================
-- TABLE: push_subscriptions (PWA push notifications)
-- ============================================================

create table push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

-- ============================================================
-- ROW LEVEL SECURITY POLICIES
-- ============================================================

-- invite_tokens is intentionally excluded from RLS.
-- It is only ever accessed server-side via the admin (service role) client.
-- Enabling RLS with no policies would block all access, including service role
-- when using the anon key. Leave it unprotected at the RLS layer; rely on the
-- service role key being kept secret.

-- Enable RLS on all tables
alter table courses enable row level security;
alter table members enable row level security;
alter table member_profiles enable row level security;
alter table course_memberships enable row level security;
alter table bookings enable row level security;
alter table play_history enable row level security;
alter table referrals enable row level security;
alter table conversations enable row level security;
alter table conversation_participants enable row level security;
alter table messages enable row level security;
alter table announcements enable row level security;
alter table member_events enable row level security;
alter table member_event_rsvps enable row level security;
alter table focus_linkups enable row level security;
alter table focus_linkup_subscriptions enable row level security;
alter table promotions enable row level security;
alter table guest_access_requests enable row level security;
alter table play_suggestions enable row level security;
alter table push_subscriptions enable row level security;

-- Helper function: get the course IDs a member has access to
-- Returns empty array (not NULL) so = any(...) behaves correctly on no-membership rows
create or replace function get_member_course_ids(member_uuid uuid)
returns uuid[] language sql security definer as $$
  select coalesce(array_agg(course_id), array[]::uuid[])
  from course_memberships
  where member_id = member_uuid
    and status = 'active'
$$;

-- Helper function: check if user is admin
create or replace function is_admin()
returns boolean language sql security definer as $$
  select coalesce(
    (select is_admin from members where id = auth.uid()),
    false
  )
$$;

-- ---- courses ------------------------------------------------
create policy "Members can view active courses they belong to"
  on courses for select
  using (
    id = any(get_member_course_ids(auth.uid()))
    or is_admin()
  );

-- ---- members ------------------------------------------------
create policy "Members can view others in shared communities"
  on members for select
  using (
    -- Can always see own record
    id = auth.uid()
    -- Can see members who share a community
    or exists (
      select 1 from course_memberships cm1
      join course_memberships cm2 on cm1.course_id = cm2.course_id
      where cm1.member_id = auth.uid()
        and cm2.member_id = members.id
        and cm1.status = 'active'
        and cm2.status = 'active'
    )
    or is_admin()
  );

create policy "Members can update own record"
  on members for update
  using (id = auth.uid())
  with check (id = auth.uid());

-- ---- member_profiles ----------------------------------------
create policy "Profiles visible to community members"
  on member_profiles for select
  using (
    id = auth.uid()
    or (
      profile_visible = true
      and exists (
        select 1 from course_memberships cm1
        join course_memberships cm2 on cm1.course_id = cm2.course_id
        join members m on m.id = member_profiles.id
        where cm1.member_id = auth.uid()
          and cm2.member_id = member_profiles.id
          and cm1.status = 'active'
          and cm2.status = 'active'
      )
    )
    or is_admin()
  );

create policy "Members can update own profile"
  on member_profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "Members can insert own profile"
  on member_profiles for insert
  with check (id = auth.uid());

-- ---- course_memberships -------------------------------------
create policy "Members can view own memberships"
  on course_memberships for select
  using (member_id = auth.uid() or is_admin());

-- ---- bookings -----------------------------------------------
create policy "Members can view bookings in their communities"
  on bookings for select
  using (
    member_id = auth.uid()
    or course_id = any(get_member_course_ids(auth.uid()))
    or is_admin()
  );

create policy "Members can insert own bookings"
  on bookings for insert
  with check (member_id = auth.uid());

create policy "Members can update own bookings"
  on bookings for update
  using (member_id = auth.uid())
  with check (member_id = auth.uid());

-- ---- play_history -------------------------------------------
-- INSERT is intentionally omitted: play_history rows are written only by the
-- booking API route using the admin client (service role), never directly by
-- authenticated members. SELECT is open to community members for play suggestions.
create policy "Play history visible within community"
  on play_history for select
  using (
    member_id = auth.uid()
    or course_id = any(get_member_course_ids(auth.uid()))
    or is_admin()
  );

-- ---- referrals ----------------------------------------------
create policy "Members can view own referrals"
  on referrals for select
  using (
    referring_member_id = auth.uid()
    or referred_member_id = auth.uid()
    or is_admin()
  );

create policy "Members can create referrals"
  on referrals for insert
  with check (referring_member_id = auth.uid());

-- ---- conversations ------------------------------------------
create policy "Members can view conversations they participate in"
  on conversations for select
  using (
    exists (
      select 1 from conversation_participants
      where conversation_id = conversations.id
        and member_id = auth.uid()
    )
    or is_admin()
  );

create policy "Members can create conversations"
  on conversations for insert
  with check (
    created_by = auth.uid()
    and course_id = any(get_member_course_ids(auth.uid()))
  );

-- ---- conversation_participants ------------------------------
create policy "Participants can view their conversations"
  on conversation_participants for select
  using (
    member_id = auth.uid()
    or exists (
      select 1 from conversation_participants cp
      where cp.conversation_id = conversation_participants.conversation_id
        and cp.member_id = auth.uid()
    )
    or is_admin()
  );

create policy "Members can join conversations"
  on conversation_participants for insert
  with check (member_id = auth.uid());

create policy "Members can update own read status"
  on conversation_participants for update
  using (member_id = auth.uid())
  with check (member_id = auth.uid());

-- ---- messages -----------------------------------------------
-- IMPORTANT: Admins do NOT have read access to messages (privacy)
create policy "Only participants can read messages"
  on messages for select
  using (
    exists (
      select 1 from conversation_participants
      where conversation_id = messages.conversation_id
        and member_id = auth.uid()
    )
  );

create policy "Participants can send messages"
  on messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from conversation_participants
      where conversation_id = messages.conversation_id
        and member_id = auth.uid()
    )
  );

create policy "Senders can soft-delete own messages"
  on messages for update
  using (sender_id = auth.uid())
  with check (sender_id = auth.uid());

-- ---- announcements ------------------------------------------
create policy "Published announcements visible to community members"
  on announcements for select
  using (
    (
      status = 'published'
      and course_id = any(get_member_course_ids(auth.uid()))
    )
    or author_id = auth.uid()
    or is_admin()
  );

create policy "Members can submit announcements"
  on announcements for insert
  with check (
    author_id = auth.uid()
    and course_id = any(get_member_course_ids(auth.uid()))
  );

-- ---- member_events ------------------------------------------
create policy "Published events visible to community"
  on member_events for select
  using (
    (
      status = 'published'
      and course_id = any(get_member_course_ids(auth.uid()))
    )
    or organizer_id = auth.uid()
    or is_admin()
  );

create policy "Members can submit events"
  on member_events for insert
  with check (
    organizer_id = auth.uid()
    and course_id = any(get_member_course_ids(auth.uid()))
  );

-- ---- focus_linkups ------------------------------------------
create policy "Focus LinkUps visible to community members"
  on focus_linkups for select
  using (
    course_id = any(get_member_course_ids(auth.uid()))
    or is_admin()
  );

-- ---- focus_linkup_subscriptions -----------------------------
create policy "Members manage own subscriptions"
  on focus_linkup_subscriptions for all
  using (member_id = auth.uid())
  with check (member_id = auth.uid());

-- ---- promotions ---------------------------------------------
create policy "Active promotions visible to community members"
  on promotions for select
  using (
    (
      active = true
      and (
        course_id is null
        or course_id = any(get_member_course_ids(auth.uid()))
      )
    )
    or is_admin()
  );

-- ---- guest_access_requests ----------------------------------
create policy "Members can view own guest requests"
  on guest_access_requests for select
  using (requesting_member_id = auth.uid() or is_admin());

create policy "Members can create guest requests"
  on guest_access_requests for insert
  with check (requesting_member_id = auth.uid());

-- ---- member_event_rsvps ------------------------------------
-- Members can see all RSVPs for published events in their community
-- (needed to show attendee counts/lists on event pages)
create policy "Members can view RSVPs for community events"
  on member_event_rsvps for select
  using (
    member_id = auth.uid()
    or exists (
      select 1 from member_events me
      where me.id = member_event_rsvps.event_id
        and me.course_id = any(get_member_course_ids(auth.uid()))
        and me.status = 'published'
    )
    or is_admin()
  );

create policy "Members can manage own RSVPs"
  on member_event_rsvps for insert
  with check (member_id = auth.uid());

create policy "Members can update own RSVPs"
  on member_event_rsvps for update
  using (member_id = auth.uid())
  with check (member_id = auth.uid());

create policy "Members can delete own RSVPs"
  on member_event_rsvps for delete
  using (member_id = auth.uid());

-- ---- play_suggestions ---------------------------------------
create policy "Members manage own suggestions"
  on play_suggestions for all
  using (member_id = auth.uid())
  with check (member_id = auth.uid());

-- ---- push_subscriptions -------------------------------------
create policy "Members manage own push subscriptions"
  on push_subscriptions for all
  using (member_id = auth.uid())
  with check (member_id = auth.uid());

-- ============================================================
-- REALTIME — enable for live messaging and notifications
-- ============================================================

alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table announcements;
alter publication supabase_realtime add table conversations;
alter publication supabase_realtime add table conversation_participants;

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update members.updated_at
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger members_updated_at
  before update on members
  for each row execute function update_updated_at();

create trigger member_profiles_updated_at
  before update on member_profiles
  for each row execute function update_updated_at();

-- Auto-create profile row when member is inserted
create or replace function create_member_profile()
returns trigger language plpgsql security definer as $$
begin
  insert into member_profiles (id, display_name)
  values (new.id, new.first_name || ' ' || new.last_name);
  return new;
end;
$$;

create trigger on_member_created
  after insert on members
  for each row execute function create_member_profile();
