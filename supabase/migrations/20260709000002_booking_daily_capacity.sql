-- ============================================================
-- Per-course DAILY booking capacity + atomic reservation.
--
-- Each course caps how many players may book on a given DATE,
-- summed across ALL tee times that day (e.g. 15 players on
-- July 1, a fresh 15 on July 2). This is a LinkUp-level cap,
-- distinct from the GHL calendar's per-tee-time appoinmentPerSlot.
--
-- create_bookings_for_day closes the double-booking race: two
-- concurrent requests could both read "seats left" and both
-- insert past the cap. A transaction-scoped advisory lock keyed
-- on (course, date) serializes concurrent bookings for the same
-- day, and the count + insert run in the SAME transaction so the
-- lock actually protects them. On overflow it raises
-- 'DAY_FULL:<spotsRemaining>' (all-or-nothing — a group is never
-- split across the cap).
-- ============================================================

alter table courses
  add column if not exists max_players_per_day int not null default 15;

create or replace function create_bookings_for_day(
  p_course_id uuid,
  p_date      date,
  p_capacity  int,
  p_rows      jsonb   -- JSON array of booking rows to insert (one per player)
) returns setof bookings
language plpgsql
as $$
declare
  v_used   int;
  v_needed int := coalesce(jsonb_array_length(p_rows), 0);
begin
  if v_needed = 0 then
    return;
  end if;

  -- Serialize concurrent bookings for THIS course+date only. Transaction-
  -- scoped: releases automatically on commit/rollback. Other days / courses
  -- hash to different keys, so they never block each other.
  perform pg_advisory_xact_lock(
    hashtextextended(p_course_id::text || '|' || p_date::text, 0)
  );

  -- Players already booked at this course on this date, across all tee times.
  -- Cancelled / waitlisted rows don't hold a spot; everything else (tentative,
  -- awaiting_approval, availability_confirmed, payment_confirmed, confirmed,
  -- pending) does.
  select count(*) into v_used
  from bookings
  where course_id    = p_course_id
    and booking_date = p_date
    and status not in ('cancelled', 'waitlist');

  if v_used + v_needed > p_capacity then
    raise exception 'DAY_FULL:%', greatest(p_capacity - v_used, 0)
      using errcode = 'P0001';
  end if;

  return query
  insert into bookings (
    member_id, course_id, booking_date, tee_time, players,
    guest_name, player_member_id, additional_players, status,
    amount_charged, focus_linkup_id, ghl_booking_id
  )
  select
    (r->>'member_id')::uuid,
    (r->>'course_id')::uuid,
    (r->>'booking_date')::date,
    (r->>'tee_time')::time,
    coalesce((r->>'players')::int, 1),
    r->>'guest_name',
    nullif(r->>'player_member_id', '')::uuid,
    coalesce(r->'additional_players', '[]'::jsonb),
    (r->>'status')::booking_status,
    coalesce((r->>'amount_charged')::numeric, 0),
    nullif(r->>'focus_linkup_id', '')::uuid,
    nullif(r->>'ghl_booking_id', '')
  from jsonb_array_elements(p_rows) as r
  returning *;
end;
$$;
