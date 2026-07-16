-- ============================================================
-- Atomic per-slot capacity for admin-curated (custom) tee times.
--
-- A custom course's curated dates carry a seat count PER tee time
-- (course_custom_slots.seats). Until now only the LinkUp daily cap
-- was enforced server-side; the per-slot limit was client-only, so
-- an admin lowering a slot's seats between a member loading the page
-- and submitting — or two members racing for the last seats — could
-- overfill a slot.
--
-- This folds a per-slot check into BOTH reservation functions, under
-- the SAME (course, date) advisory lock they already take, so the
-- count + insert stay atomic. For each distinct tee time in the
-- incoming rows that has a course_custom_slots row on that date, it
-- ensures existing active bookings at that tee time + the new players
-- do not exceed the curated seats. Tee times with no curated row
-- (GHL courses, or uncurated dates on a custom course) are skipped —
-- their behaviour is unchanged.
--
-- On violation it raises 'SLOT_FULL:<HH24:MI>:<remaining>' with
-- errcode P0001, mirroring the DAY_FULL contract so routes can parse
-- and surface it.
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
  v_slot      record;
  v_seats     int;
  v_slot_used int;
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

  -- Per-slot capacity for admin-curated tee times (custom courses). For each
  -- distinct tee time being booked that has a curated seat count on this date,
  -- reject the group if it would overfill that slot. Runs under the same lock,
  -- so the count is consistent with the insert below.
  for v_slot in
    select (r->>'tee_time')::time as tee_time, count(*)::int as needed
    from jsonb_array_elements(p_rows) as r
    group by (r->>'tee_time')::time
  loop
    select seats into v_seats
    from course_custom_slots
    where course_id = p_course_id
      and slot_date = p_date
      and tee_time  = v_slot.tee_time;

    if found then
      select count(*) into v_slot_used
      from bookings
      where course_id    = p_course_id
        and booking_date = p_date
        and tee_time     = v_slot.tee_time
        and status not in ('cancelled', 'waitlist');

      if v_slot_used + v_slot.needed > v_seats then
        raise exception 'SLOT_FULL:%:%',
          to_char(v_slot.tee_time, 'HH24:MI'),
          greatest(v_seats - v_slot_used, 0)
          using errcode = 'P0001';
      end if;
    end if;
  end loop;

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
  v_slot      record;
  v_seats     int;
  v_slot_used int;
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

  -- Per-slot capacity for admin-curated tee times (see create_bookings_for_day).
  for v_slot in
    select (r->>'tee_time')::time as tee_time, count(*)::int as needed
    from jsonb_array_elements(p_rows) as r
    group by (r->>'tee_time')::time
  loop
    select seats into v_seats
    from course_custom_slots
    where course_id = p_course_id
      and slot_date = p_date
      and tee_time  = v_slot.tee_time;

    if found then
      select count(*) into v_slot_used
      from bookings
      where course_id    = p_course_id
        and booking_date = p_date
        and tee_time     = v_slot.tee_time
        and status not in ('cancelled', 'waitlist');

      if v_slot_used + v_slot.needed > v_seats then
        raise exception 'SLOT_FULL:%:%',
          to_char(v_slot.tee_time, 'HH24:MI'),
          greatest(v_seats - v_slot_used, 0)
          using errcode = 'P0001';
      end if;
    end if;
  end loop;

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
