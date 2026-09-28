-- A player added to a round inherits how that round is paid for.
--
-- 20260926000001 did this for create_bookings_for_day; this is the same one
-- column for add_players_to_booking, which POST /api/bookings/[id]/players
-- inserts through. Without it the booker's own row at a pay-at-club venue was
-- created settled at the club while every guest they added was created owing
-- payment through an app with no checkout to send them to — the guest would be
-- shown a payment banner the booker never saw.
--
-- Otherwise verbatim from 20260718000000_custom_slot_seat_check.sql.
-- ------------------------------------------------------------

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
    amount_charged, focus_linkup_id, ghl_booking_id, payment_method, created_at
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
    nullif(r->>'payment_method', ''),
    p_created_at
  from jsonb_array_elements(p_rows) as r
  returning *;
end;
$$;
