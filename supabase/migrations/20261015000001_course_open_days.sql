-- ============================================================
-- Venue-days an admin has forced open inside the join-only window.
--
-- Inside the last three days (src/lib/bookings/lead-time.ts) a venue-day
-- with nobody booked on it is closed: a member can join a round that's going
-- out but can't start one at that notice. Sometimes the club has said yes
-- anyway — a slot it wants filled, a group that called ahead — and the admin
-- needs a way to say so.
--
-- One row per (course, date) means "this day is open whether or not anyone
-- has booked it". Absence of a row is the rule as it always was. It only
-- matters inside the window; outside it the day was open already, and a row
-- there changes nothing.
--
-- It lifts the window and nothing else: the GHL calendar still has to have a
-- tee time open, and the venue's daily cap still applies.
-- ============================================================

create table if not exists course_open_days (
  course_id   uuid not null references courses(id) on delete cascade,
  open_date   date not null,
  -- Which admin opened it. Nullable so deleting that member doesn't take the
  -- override with it.
  opened_by   uuid references members(id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (course_id, open_date)
);

-- Read in date ranges across many venues by the month calendar.
create index if not exists course_open_days_date_idx
  on course_open_days (open_date);

-- Only ever read/written server-side via the service-role admin client
-- (which bypasses RLS). Block all direct client access, mirroring
-- course_custom_slots.
alter table course_open_days enable row level security;

create policy "No direct client access to course_open_days"
  on course_open_days
  as restrictive
  for all
  to public
  using (false)
  with check (false);
