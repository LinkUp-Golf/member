-- ============================================================
-- Backfill member_activity_events from history the app already
-- has, so the usage report is useful the day it ships instead of
-- starting blank.
--
-- Scope rule: seed ONLY the activity the live tracker also
-- records. Anything else would put a source in the report that
-- dries up the moment the backfill is done, and an admin reading
-- "RSVPs: 40 last quarter, 0 since" would be reading an artefact
-- of this migration rather than the membership.
--
-- Everything inserted here is stamped metadata.backfilled = true.
-- The report reads its "tracking since" date from live rows only,
-- so seeded history is never presented as measured behaviour.
--
-- Idempotent: every insert is guarded by NOT EXISTS on the same
-- member/action/timestamp, so a re-run (or a db:reset) adds
-- nothing twice.
-- ============================================================

-- ---- 1. Sign-ins -------------------------------------------
-- members.last_sign_in has been stamped at every magic-link login
-- since 20260521120000. It holds only the MOST RECENT sign-in —
-- there is no per-login history to recover — so this seeds exactly
-- one event per member. Read it as "last seen", not as a count:
-- a member with 200 logins and one with 2 both get a single row.

insert into member_activity_events (member_id, course_id, area, action, kind, path, metadata, created_at)
select
  m.id,
  m.home_course_id,
  'session',
  'signed_in',
  'action',
  '/login',
  jsonb_build_object('backfilled', true, 'source', 'members.last_sign_in'),
  m.last_sign_in
from members m
where m.last_sign_in is not null
  and not exists (
    select 1 from member_activity_events e
    where e.member_id = m.id
      and e.action = 'signed_in'
      and e.created_at = m.last_sign_in
  );

-- ---- 2. Bookings -------------------------------------------
-- A booking writes one row per player, all sharing created_at, so
-- distinct on (member, course, created_at) collapses a group back
-- into the single act of booking it was.
--
-- Cancellations are deliberately not seeded: bookings records the
-- cancelled status but no cancellation timestamp, and an event is
-- only worth having if it can be placed in time.

insert into member_activity_events (member_id, course_id, area, action, kind, target_id, path, metadata, created_at)
select distinct on (b.member_id, b.course_id, b.created_at)
  b.member_id,
  b.course_id,
  'calendars',
  'booking_created',
  'action',
  b.id,
  '/book',
  jsonb_build_object('backfilled', true, 'source', 'bookings'),
  b.created_at
from bookings b
where not exists (
    select 1 from member_activity_events e
    where e.member_id = b.member_id
      and e.action = 'booking_created'
      and e.created_at = b.created_at
  )
order by b.member_id, b.course_id, b.created_at, b.id;

-- ---- 3. Hosted event reservations --------------------------
-- Cancelled rows are kept as history by design (see the partial
-- unique index in 20260721000002), and a member who later
-- cancelled still reserved a spot — that reservation is the event.

insert into member_activity_events (member_id, course_id, area, action, kind, target_id, path, metadata, created_at)
select
  r.member_id,
  m.home_course_id,
  'calendars',
  'hosted_event_registered',
  'action',
  r.hosted_event_id,
  '/more/hosted-events/' || r.hosted_event_id,
  jsonb_build_object('backfilled', true, 'source', 'hosted_event_registrations'),
  r.created_at
from hosted_event_registrations r
join members m on m.id = r.member_id
where not exists (
    select 1 from member_activity_events e
    where e.member_id = r.member_id
      and e.action = 'hosted_event_registered'
      and e.created_at = r.created_at
  );

-- ---- 4. First direct message to another member -------------
-- Matches what the live route records: a new direct thread, not
-- every message in it. The target is the other participant, which
-- is what makes this a member-directory action rather than a
-- messaging one.

insert into member_activity_events (member_id, course_id, area, action, kind, target_id, path, metadata, created_at)
select
  c.created_by,
  c.course_id,
  'directory',
  'member_message_started',
  'action',
  other.member_id,
  '/members/' || other.member_id,
  jsonb_build_object('backfilled', true, 'source', 'conversations'),
  c.created_at
from conversations c
join lateral (
  select p.member_id
  from conversation_participants p
  where p.conversation_id = c.id
    and p.member_id <> c.created_by
  -- Direct threads have exactly one other participant; the limit is a
  -- guard against a malformed row fanning out into duplicate events.
  limit 1
) other on true
where c.type = 'direct'
  and not exists (
    select 1 from member_activity_events e
    where e.member_id = c.created_by
      and e.action = 'member_message_started'
      and e.created_at = c.created_at
  );

-- ---- Report ------------------------------------------------
do $$
declare
  seeded integer;
begin
  select count(*) into seeded
  from member_activity_events
  where metadata->>'backfilled' = 'true';

  raise notice 'member_activity_events: % backfilled rows present', seeded;
end $$;

-- Backfilled rows are excluded from the report's "tracking since"
-- date, which needs this index to stay a cheap lookup once the
-- table has real volume.
create index if not exists member_activity_live_created_idx
  on member_activity_events (created_at)
  where metadata->>'backfilled' is null;
