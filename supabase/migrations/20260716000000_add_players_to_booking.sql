-- ============================================================
-- add_players_to_booking: append players to an ALREADY-EXISTING
-- booking group.
--
-- A booker can add a player to a round they've already booked even
-- when they themselves have a payment due — that FIFO gate only
-- governs creating a *new* booking, not expanding an existing one.
-- So, unlike create_bookings_for_day, this function deliberately
-- runs NO payment-due (FIFO) check. It still enforces the per-course
-- daily capacity atomically, under the same course+date advisory
-- lock, so a late add can never overfill the day.
--
-- The new rows are stamped with the parent group's created_at
-- (p_created_at) so the app's booking grouping (member_id +
-- created_at + date + tee_time) nests them inside the existing card
-- rather than fabricating a separate one.
--
-- On over-capacity it raises 'DAY_FULL:<remaining>' with errcode
-- P0001, matching create_bookings_for_day's contract so the route
-- can parse and surface it identically.
-- ============================================================

create or replace function add_players_to_booking(
  p_course_id  uuid,
  p_date       date,
  p_capacity   int,
  p_rows       jsonb,        -- JSON array of booking rows to insert (one per added player)
  p_created_at timestamptz   -- parent group's created_at, so new rows group with it
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

  -- Serialize concurrent writes for THIS course+date only (same key as
  -- create_bookings_for_day), so the capacity count + insert below is atomic
  -- against simultaneous bookings/adds on the same day.
  perform pg_advisory_xact_lock(
    hashtextextended(p_course_id::text || '|' || p_date::text, 0)
  );

  -- Daily capacity across all tee times for this course+date. Cancelled /
  -- waitlisted rows don't hold a spot; everything else does. Mirrors
  -- create_bookings_for_day exactly (there is NO FIFO check here by design).
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
    amount_charged, focus_linkup_id, ghl_booking_id, created_at
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
    nullif(r->>'ghl_booking_id', ''),
    p_created_at
  from jsonb_array_elements(p_rows) as r
  returning *;
end;
$$;
