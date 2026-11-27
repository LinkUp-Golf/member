-- The playing host booking the day's first foursome themselves (2026-11-27).
--
-- 20261127000001 recognised that the host was already playing and didn't seat
-- them twice — but left their own booking an ordinary round: priced, chased for
-- payment, invoiced if cancelled late, and without the admin's Replace button.
-- Their own seat now *becomes* the host seat, as if the app had placed it.
--
-- Also: a host seat is never under the cancellation policy. It's free, so a
-- late-cancel fee would be a share of nothing — but the fee is priced from the
-- venue's rate when a seat's own amount is 0, so it has to be exempt outright.

create or replace function seat_playing_host(
  p_course_id      uuid,
  p_date           date,
  p_tee_time       time,
  p_member_id      uuid,
  p_capacity       int,
  p_seats_per_slot int    -- the GHL calendar's seats per tee time; null = unknown
) returns setof bookings
language plpgsql
as $$
declare
  v_used      int;
  v_slot_used int;
  v_seats     int;
  v_own_id    uuid;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_course_id::text || '|' || p_date::text, 0)
  );

  insert into playing_host_days (course_id, booking_date)
  values (p_course_id, p_date)
  on conflict do nothing;
  if not found then
    return;  -- already decided
  end if;

  -- Their own seat that day, earliest tee time first: it becomes the host seat.
  select id into v_own_id
  from bookings
  where course_id = p_course_id
    and booking_date = p_date
    and status not in ('cancelled', 'waitlist')
    and member_id = p_member_id and guest_name is null and player_member_id is null
  order by tee_time, created_at
  limit 1;

  if v_own_id is not null then
    return query
    update bookings
    set playing_host = true,
        amount_charged = 0,
        payment_method = null,
        cancellation_policy_applies = false,
        status = case when status in ('tentative', 'availability_confirmed', 'pending')
                      then 'payment_confirmed'::booking_status else status end
    where id = v_own_id
    returning *;
    return;
  end if;

  -- Added to somebody else's booking: they're playing, and that seat is the
  -- booker's to arrange. The day stays decided.
  if exists (
    select 1 from bookings
    where course_id = p_course_id
      and booking_date = p_date
      and status not in ('cancelled', 'waitlist')
      and player_member_id = p_member_id
  ) then
    return;
  end if;

  select count(*) into v_used
  from bookings
  where course_id = p_course_id
    and booking_date = p_date
    and status not in ('cancelled', 'waitlist');

  select seats into v_seats
  from course_custom_slots
  where course_id = p_course_id and slot_date = p_date and tee_time = p_tee_time;
  v_seats := coalesce(v_seats, p_seats_per_slot);

  select count(*) into v_slot_used
  from bookings
  where course_id = p_course_id
    and booking_date = p_date
    and tee_time = p_tee_time
    and status not in ('cancelled', 'waitlist');

  if v_used + 1 > p_capacity or (v_seats is not null and v_slot_used + 1 > v_seats) then
    delete from playing_host_days where course_id = p_course_id and booking_date = p_date;
    return;  -- no room here; the next foursome booked that day gets them
  end if;

  return query
  insert into bookings (
    member_id, course_id, booking_date, tee_time, players,
    guest_name, player_member_id, additional_players, status,
    amount_charged, playing_host, cancellation_policy_applies
  ) values (
    p_member_id, p_course_id, p_date, p_tee_time, 1,
    null, null, '[]'::jsonb, 'payment_confirmed'::booking_status,
    0, true, false
  )
  returning *;
end;
$$;

-- Host seats already placed: free, so never under the cancellation policy.
update bookings set cancellation_policy_applies = false
where playing_host and cancellation_policy_applies;

-- Upcoming days the host booked themselves before this ran (Greg's Dec 9 on
-- staging): their earliest own seat that day becomes the host seat, on any day
-- that doesn't have one yet.
with own as (
  select distinct on (b.course_id, b.booking_date) b.id
  from bookings b
  join courses c on c.id = b.course_id
  where c.playing_host_member_id is not null
    and b.member_id = c.playing_host_member_id
    and b.guest_name is null
    and b.player_member_id is null
    and b.booking_date >= current_date
    and b.status not in ('cancelled', 'waitlist')
    and not exists (
      select 1 from bookings h
      where h.course_id = b.course_id and h.booking_date = b.booking_date
        and h.playing_host and h.status not in ('cancelled', 'waitlist')
    )
  order by b.course_id, b.booking_date, b.tee_time, b.created_at
)
update bookings b
set playing_host = true,
    amount_charged = 0,
    payment_method = null,
    cancellation_policy_applies = false,
    status = case when b.status in ('tentative', 'availability_confirmed', 'pending')
                  then 'payment_confirmed'::booking_status else b.status end
from own
where b.id = own.id;
