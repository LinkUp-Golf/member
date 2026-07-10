-- ============================================================
-- Atomic FIFO (payment-due) guard inside create_bookings_for_day.
--
-- LinkUp's FIFO rule: a member may not create a new booking while
-- they still owe payment on an existing one (status
-- 'availability_confirmed' — a payment link has been sent) for an
-- upcoming date. This applies to the booker AND to every member
-- guest pulled into a group round.
--
-- The API route already checks this before it starts, but that's a
-- check-then-act gap: between the check and the insert (non-member
-- GHL contact lookups, appointment prep, the RPC call itself) a GHL
-- webhook can flip one of those members' existing bookings to
-- 'availability_confirmed'. Folding the check into the same
-- transaction that reserves the seats closes that window — it now
-- runs under the reservation's snapshot, so a payment link that
-- lands mid-flight is caught here instead of slipping past.
--
-- On violation it raises 'PENDING_PAYMENT:<id,id,...>' (the member
-- ids that now owe) with errcode P0001, mirroring the existing
-- 'DAY_FULL:<n>' contract so the route can parse and surface it.
-- ============================================================

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
  v_pending_members uuid[];
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

  -- FIFO guard: no member on this booking — the booker (member_id, present on
  -- every row) or any member guest (player_member_id) — may already hold an
  -- upcoming round awaiting payment ('availability_confirmed'). Runs in the
  -- same transaction as the insert below, so it sees any payment link committed
  -- by a GHL webhook right up to this point. Our own rows are still
  -- tentative / awaiting_approval (and not yet inserted), so they never
  -- self-trigger this.
  select array_agg(distinct ids.m) into v_pending_members
  from (
    select (r->>'member_id')::uuid as m
    from jsonb_array_elements(p_rows) r
    union
    select nullif(r->>'player_member_id', '')::uuid
    from jsonb_array_elements(p_rows) r
  ) ids
  where ids.m is not null
    and exists (
      select 1
      from bookings b
      where (b.member_id = ids.m or b.player_member_id = ids.m)
        and b.status = 'availability_confirmed'
        and b.booking_date >= current_date
    );

  if v_pending_members is not null and array_length(v_pending_members, 1) > 0 then
    raise exception 'PENDING_PAYMENT:%', array_to_string(v_pending_members, ',')
      using errcode = 'P0001';
  end if;

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
