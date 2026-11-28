-- Slot-release notice: an email to a club, a set number of hours before each
-- tee time we hold there, when fewer than a set number of players are signed
-- up. Agreed with Aviara management (2026-11-28): 72 hours before every Aviara
-- foursome with fewer than four players (the host counts), to the golf shop,
-- copied to Greg. Rules in src/lib/venues/slot-release-notice.ts; sent by
-- /api/cron/slot-release-notices.
--
-- A venue setting rather than an Aviara constant, so the address, timing and
-- wording are edited on the venue's admin form, and a club with a similar
-- arrangement is switched on there too.

alter table courses
  add column if not exists slot_release_notice_enabled boolean not null default false,
  -- Comma-separated addresses.
  add column if not exists slot_release_notice_to text,
  add column if not exists slot_release_notice_cc text,
  add column if not exists slot_release_notice_hours integer not null default 72,
  add column if not exists slot_release_notice_min_players integer not null default 4,
  -- Null = the default wording in slot-release-notice.ts.
  add column if not exists slot_release_notice_body text;

alter table courses drop constraint if exists courses_slot_release_notice_hours_check;
alter table courses add constraint courses_slot_release_notice_hours_check
  check (slot_release_notice_hours between 1 and 720);

alter table courses drop constraint if exists courses_slot_release_notice_min_players_check;
alter table courses add constraint courses_slot_release_notice_min_players_check
  check (slot_release_notice_min_players between 1 and 100);

-- One row per tee time a notice went out for. The unique key is how a cron run
-- claims a tee time before sending, so two overlapping runs can't both send.
create table if not exists slot_release_notices (
  id           uuid primary key default gen_random_uuid(),
  course_id    uuid not null references courses(id) on delete cascade,
  booking_date date not null,
  tee_time     time not null,
  players      integer not null,
  host_name    text,
  sent_to      text,
  sent_at      timestamptz not null default now(),
  unique (course_id, booking_date, tee_time)
);

-- Written and read only through the service role.
alter table slot_release_notices enable row level security;

-- ---- Park Hyatt Aviara ------------------------------------------------------
update courses
set slot_release_notice_enabled     = true,
    slot_release_notice_to          = 'Sanpa-golf.static@hyatt.com',
    slot_release_notice_cc          = 'greg@linkup.golf',
    slot_release_notice_hours       = 72,
    slot_release_notice_min_players = 4
where name = 'Park Hyatt Aviara Golf Club';
