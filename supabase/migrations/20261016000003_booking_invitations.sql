-- Added players: who pays for them, and their answer to the invitation.
--
-- A booker adding a player to a round now says, for each one, whether they're
-- paying for that player's seat or the player pays their own. And the player —
-- a fellow member, or a non-member guest once provisioned — is sent an
-- invitation they accept or decline, rather than simply finding themselves on
-- the round.
--
--   paid_by_booker  true when the booker covers this seat. Such a seat is the
--                   booker's to pay, so it no longer counts against the
--                   player in the payment-due (FIFO) check below.
--   invite_status   'pending' | 'accepted' | 'declined' on an added player's
--                   row; null on the booker's own row and on every row written
--                   before this — nobody was ever asked, so there is nothing
--                   to answer. A decline also cancels the row, which frees the
--                   seat; the column keeps the reason.
--
-- create_bookings_for_day and add_players_to_booking are otherwise verbatim from
-- 20260926000001 / 20260926000002, with the two columns added to their inserts
-- and the FIFO rule in create narrowed as described.
-- ------------------------------------------------------------

alter table bookings
  add column if not exists paid_by_booker boolean not null default false,
  add column if not exists invite_status text
    check (invite_status in ('pending', 'accepted', 'declined')),
  add column if not exists invite_responded_at timestamptz;

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

  perform pg_advisory_xact_lock(
    hashtextextended(p_course_id::text || '|' || p_date::text, 0)
  );

  -- FIFO guard: no member on this booking may already hold an upcoming round
  -- awaiting payment through the app. A round they've chosen to pay at the club
  -- isn't awaiting anything from us, so it doesn't count.
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
      where (
              b.member_id = ids.m
              -- An added player owes for their own seat only when the booker
              -- isn't paying for it.
              or (b.player_member_id = ids.m and not b.paid_by_booker)
            )
        and b.status = 'availability_confirmed'
        and b.payment_method is null
        and b.booking_date >= current_date
    );

  if v_pending_members is not null and array_length(v_pending_members, 1) > 0 then
    raise exception 'PENDING_PAYMENT:%', array_to_string(v_pending_members, ',')
      using errcode = 'P0001';
  end if;

  select count(*) into v_used
  from bookings
  where course_id    = p_course_id
    and booking_date = p_date
    and status not in ('cancelled', 'waitlist');

  if v_used + v_needed > p_capacity then
    raise exception 'DAY_FULL:%', greatest(p_capacity - v_used, 0)
      using errcode = 'P0001';
  end if;

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
    amount_charged, focus_linkup_id, ghl_booking_id, payment_method,
    paid_by_booker, invite_status
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
    coalesce((r->>'paid_by_booker')::boolean, false),
    nullif(r->>'invite_status', '')
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
    amount_charged, focus_linkup_id, ghl_booking_id, payment_method, created_at,
    paid_by_booker, invite_status
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
    p_created_at,
    coalesce((r->>'paid_by_booker')::boolean, false),
    nullif(r->>'invite_status', '')
  from jsonb_array_elements(p_rows) as r
  returning *;
end;
$$;
