-- How a venue takes payment, and a booking that will be settled at the club.
--
-- courses.payment_options — which ways members can pay for a round here:
--   'pay_now'      the venue's online checkout (payment_url). What every course
--                  did before this column, so it's the default and existing
--                  rows keep behaving exactly as they did.
--   'pay_at_club'  the member settles with the club on the day.
-- At least one, and only those two, so a course is always payable somehow.
--
-- bookings.payment_method — set to 'pay_at_club' when the member chooses to
-- settle at the club. null means the online checkout, which is every booking
-- before this and every booking that doesn't choose otherwise. The status is
-- left alone: nothing has been paid yet, and GHL still owns moving the round
-- through its pipeline. What changes is that the round stops counting as
-- "payment due" — it no longer blocks the member from booking again.

ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS payment_options text[] NOT NULL DEFAULT ARRAY['pay_now']::text[];

ALTER TABLE courses DROP CONSTRAINT IF EXISTS courses_payment_options_check;
ALTER TABLE courses
  ADD CONSTRAINT courses_payment_options_check CHECK (
    cardinality(payment_options) >= 1
    AND payment_options <@ ARRAY['pay_now', 'pay_at_club']::text[]
  );

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_method text;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_method_check;
ALTER TABLE bookings
  ADD CONSTRAINT bookings_payment_method_check CHECK (
    payment_method IS NULL OR payment_method = 'pay_at_club'
  );

-- ------------------------------------------------------------
-- FIFO guard: a round being paid at the club isn't owed through the app.
--
-- Same function as 20260718000000_custom_slot_seat_check.sql, with one change
-- to the PENDING_PAYMENT check: a row whose payment_method is 'pay_at_club' no
-- longer blocks a new booking. Must stay in step with
-- findPendingPaymentBookings (src/lib/bookings/pending-payment.ts), which the
-- route checks first.
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
