-- The playing host: a member who plays in the first foursome of every day at a
-- venue (Greg Lipper at Park Hyatt Aviara, 2026-11-27).
--
-- Until now the "Who's playing" sheet put the venue's GHL calendar user at the
-- head of every tee time as "Host" — at Aviara that was "Greg 2", a GHL user who
-- isn't a member and doesn't play. What Greg wants instead is a real seat: one of
-- the four in the day's first foursome, held by a booking row so members see 3
-- spots open and a fifth person can't book in. See src/lib/bookings/playing-host.ts.
--
--   courses.playing_host_member_id   who plays at this venue (null = nobody)
--   bookings.playing_host            this row is that seat: free, never chased
--                                    for payment, replaceable by an admin
--   playing_host_days                one row per venue-day once the seat has
--                                    been decided, so it's decided once: an
--                                    admin who removes the host isn't overruled
--                                    by the next booking, and the host isn't
--                                    moved when somebody books earlier later on

alter table courses
  add column if not exists playing_host_member_id uuid references members(id) on delete set null;

alter table bookings
  add column if not exists playing_host boolean not null default false;

create table if not exists playing_host_days (
  course_id    uuid not null references courses(id) on delete cascade,
  booking_date date not null,
  created_at   timestamptz not null default now(),
  primary key (course_id, booking_date)
);

-- Service role only, like the booking RPCs that write it.
alter table playing_host_days enable row level security;

-- Seats the venue's playing host in the given tee time, if this day hasn't been
-- decided yet. Returns the new row, or nothing when there's nothing to do:
--   * the day was already decided (seated, removed or replaced by an admin)
--   * the host already holds a seat that day (they booked or were added)
--   * the tee time or the day is full — then the day is left undecided, so the
--     next foursome booked that day takes them instead
-- Takes the same advisory lock as create_bookings_for_day, so two first
-- bookings landing together can't both seat the host, or overfill the day.
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

  if exists (
    select 1 from bookings
    where course_id = p_course_id
      and booking_date = p_date
      and status not in ('cancelled', 'waitlist')
      and (player_member_id = p_member_id
           or (member_id = p_member_id and guest_name is null and player_member_id is null))
  ) then
    return;  -- they're already playing that day; the day stays decided
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
    amount_charged, playing_host
  ) values (
    p_member_id, p_course_id, p_date, p_tee_time, 1,
    null, null, '[]'::jsonb, 'payment_confirmed'::booking_status,
    0, true
  )
  returning *;
end;
$$;

-- ---- Park Hyatt Aviara: Greg Lipper ---------------------------------------
update courses
set playing_host_member_id = (select id from members where lower(email) = 'greg@linkup.golf' limit 1)
where name = 'Park Hyatt Aviara Golf Club';

-- Days already booked were set up by hand (Greg added himself), so they count
-- as decided: the next booking on one of them must not add him a second time.
insert into playing_host_days (course_id, booking_date)
select distinct b.course_id, b.booking_date
from bookings b
join courses c on c.id = b.course_id
where c.playing_host_member_id is not null
  and b.booking_date >= current_date
  and b.status not in ('cancelled', 'waitlist')
on conflict do nothing;

-- Greg's own upcoming seats there become host seats: free and never chased.
update bookings b
set playing_host = true,
    amount_charged = 0,
    status = case when b.status in ('tentative', 'availability_confirmed', 'pending')
                  then 'payment_confirmed'::booking_status else b.status end
from courses c
where c.id = b.course_id
  and c.playing_host_member_id is not null
  and b.member_id = c.playing_host_member_id
  and b.guest_name is null
  and b.player_member_id is null
  and b.booking_date >= current_date
  and b.status not in ('cancelled', 'waitlist');
