-- ============================================================
-- Admin-curated (custom) tee-time slots per course.
--
-- By default a course's bookable dates and tee times come live
-- from its GHL calendar. When custom_slots_enabled is true, the
-- admin can override specific dates: for a curated date, GHL is
-- still the source of truth for what times exist, but the admin
-- picks which of those to offer and may add extra custom times,
-- each with its own seat count.
--
-- One row per offered tee time on a date. Curation is a per-date
-- OVERRIDE: only dates that have rows here use these tee times;
-- every other date keeps its normal GHL availability. GHL courses
-- (custom_slots_enabled = false) ignore this table entirely.
-- ============================================================

alter table courses
  add column if not exists custom_slots_enabled boolean not null default false;

create table if not exists course_custom_slots (
  id          uuid primary key default gen_random_uuid(),
  course_id   uuid not null references courses(id) on delete cascade,
  slot_date   date not null,
  tee_time    time not null,
  seats       int  not null check (seats >= 1),
  -- Informational: 'ghl' = a tee time selected from the GHL calendar,
  -- 'custom' = a time the admin added by hand. Lets the admin UI badge origin.
  source      text not null default 'custom' check (source in ('ghl', 'custom')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (course_id, slot_date, tee_time)
);

create index if not exists course_custom_slots_course_date_idx
  on course_custom_slots (course_id, slot_date);

-- Only ever read/written server-side via the service-role admin client
-- (which bypasses RLS). Block all direct client access, mirroring
-- invite_tokens.
alter table course_custom_slots enable row level security;

create policy "No direct client access to course_custom_slots"
  on course_custom_slots
  as restrictive
  for all
  to public
  using (false)
  with check (false);
