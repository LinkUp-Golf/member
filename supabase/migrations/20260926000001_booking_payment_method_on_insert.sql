-- A booking at a venue that only takes payment at the club is created that way.
--
-- bookings.payment_method could only be set after the fact, by the member
-- pressing "Pay at club" on a round whose availability GHL had already
-- confirmed. At a venue that takes payment on the app as well, that press is a
-- real choice. At a venue that takes nothing else it was a formality: the
-- member was shown a button to select the only option there was, and until they
-- pressed it the round sat on their payment banner as owed through an app that
-- has no checkout to send them to.
--
-- So POST /api/bookings/create now passes payment_method on the rows it inserts
-- — 'pay_at_club' when that is the venue's only option, null otherwise — and
-- this adds the column to the insert. Nothing else about the function changes;
-- it is otherwise verbatim from 20260917000001_payment_options.sql.
--
-- Deliberately not backfilled. An existing unmarked booking keeps the button,
-- which still works, rather than having a payment method written onto it by a
-- migration the member never saw.
-- ------------------------------------------------------------

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
      where (b.member_id = ids.m or b.player_member_id = ids.m)
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
    amount_charged, focus_linkup_id, ghl_booking_id, payment_method
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
    nullif(r->>'payment_method', '')
  from jsonb_array_elements(p_rows) as r
  returning *;
end;
$$;
