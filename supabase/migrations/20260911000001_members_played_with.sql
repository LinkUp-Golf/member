-- Who a member has actually shared a round with.
--
-- The utilization report can say how much of the app someone uses, but not
-- whether they've met anybody through it — which, for a club whose product is
-- introductions, is the more interesting half. This answers it from the
-- records the app already keeps, with no new table and nothing to backfill.
--
-- Two things count as a round together:
--
--   * A booking at the same course, date and tee time. A group booking is one
--     row per seat (see create_bookings_for_day), so the group is recovered by
--     grouping those three columns rather than by any group id — which also
--     picks up two members who booked the same slot separately and teed off
--     together anyway. A curated slot may seat more than a foursome, so this
--     is "on the course at the same time", not strictly "in the same cart".
--
--   * A hosted event. Everyone holding a reserved spot plays it, and so does
--     the host.
--
-- A booking row names its member in up to three ways, and all three are
-- resolved here:
--
--   member_id        the booker — present on every row of their group
--   player_member_id a member they brought along as a guest
--   additional_players[0].email
--                    a NON-member guest. provisionNonMemberGuest creates a
--                    real member row for them at booking time but never writes
--                    it back to player_member_id, so the only link left is the
--                    email the booker typed. Matched case-insensitively, the
--                    same way 20260708000001 backfilled member guest links.
--                    Without this the people most worth surfacing — newcomers
--                    brought onto a round by a member — would be invisible.
--
-- Cancelled and waitlisted seats don't count: nobody played them. Future
-- rounds are counted separately from played ones, so "3 rounds" always means
-- three rounds that happened, and a pair with a round booked for next week
-- still shows up.
--
-- Unfiltered by the report's date window on purpose. The window asks "what
-- happened lately"; this asks "who does this person know", and a 30-day cut of
-- that is nearly always empty.

drop function if exists members_played_with(uuid);

create function members_played_with(p_member_id uuid)
returns table (
  member_id         uuid,
  first_name        text,
  last_name         text,
  email             text,
  membership_status membership_status,
  is_admin          boolean,
  course_name       text,
  rounds            bigint,
  upcoming          bigint,
  last_played       date,
  next_round        date
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select id, lower(email) as email
    from members
    where id = p_member_id
  ),

  -- The slots this member sat in. One seq scan over bookings: the email match
  -- can't use an index, so ORing it with the two that can would cost the scan
  -- regardless.
  my_slots as (
    select b.course_id, b.booking_date, b.tee_time
    from bookings b
    cross join me
    where b.status not in ('cancelled', 'waitlist')
      and (
        b.member_id = me.id
        or b.player_member_id = me.id
        or lower(b.additional_players -> 0 ->> 'email') = me.email
      )
    group by 1, 2, 3
  ),

  -- Everyone in those slots, one row per (slot, member). UNION rather than
  -- UNION ALL: the booker appears on every row of their own group, and a
  -- member guest's row names two people.
  slot_seats as (
    select b.course_id, b.booking_date, b.tee_time, b.member_id as seat_member
    from bookings b
    join my_slots s
      on s.course_id    = b.course_id
     and s.booking_date = b.booking_date
     and s.tee_time     = b.tee_time
    where b.status not in ('cancelled', 'waitlist')

    union

    select b.course_id, b.booking_date, b.tee_time, b.player_member_id
    from bookings b
    join my_slots s
      on s.course_id    = b.course_id
     and s.booking_date = b.booking_date
     and s.tee_time     = b.tee_time
    where b.status not in ('cancelled', 'waitlist')
      and b.player_member_id is not null

    union

    select b.course_id, b.booking_date, b.tee_time, g.id
    from bookings b
    join my_slots s
      on s.course_id    = b.course_id
     and s.booking_date = b.booking_date
     and s.tee_time     = b.tee_time
    join members g
      on lower(g.email) = lower(b.additional_players -> 0 ->> 'email')
    where b.status not in ('cancelled', 'waitlist')
      and b.player_member_id is null
  ),

  -- Hosted events this member was on, as a guest or as the host.
  my_events as (
    select r.hosted_event_id as event_id
    from hosted_event_registrations r
    join hosted_events e on e.id = r.hosted_event_id
    where r.member_id = p_member_id
      and r.status = 'reserved'
      and e.status <> 'cancelled'

    union

    select e.id
    from hosted_events e
    join hosts h on h.id = e.host_id
    where h.member_id = p_member_id
      and e.status <> 'cancelled'
  ),

  event_seats as (
    select e.id as event_id, e.event_date, r.member_id as seat_member
    from hosted_event_registrations r
    join my_events mine on mine.event_id = r.hosted_event_id
    join hosted_events e on e.id = r.hosted_event_id
    where r.status = 'reserved'
      and e.status <> 'cancelled'

    union

    select e.id, e.event_date, h.member_id
    from hosted_events e
    join my_events mine on mine.event_id = e.id
    join hosts h on h.id = e.host_id
    where e.status <> 'cancelled'
  ),

  -- Both kinds of round in one shape. The key only has to be unique across
  -- rounds; it's never returned.
  seats as (
    select
      format('b:%s:%s:%s', course_id, booking_date, tee_time) as round_key,
      booking_date as played_on,
      seat_member
    from slot_seats

    union

    select format('h:%s', event_id), event_date, seat_member
    from event_seats
  )

  select
    m.id,
    m.first_name,
    m.last_name,
    m.email,
    m.membership_status,
    m.is_admin,
    c.name,
    count(*) filter (where s.played_on <= current_date)::bigint as rounds,
    count(*) filter (where s.played_on >  current_date)::bigint as upcoming,
    max(s.played_on) filter (where s.played_on <= current_date) as last_played,
    min(s.played_on) filter (where s.played_on >  current_date) as next_round
  from seats s
  join members m on m.id = s.seat_member
  left join courses c on c.id = m.home_course_id
  where s.seat_member is not null
    and s.seat_member <> p_member_id
  group by m.id, m.first_name, m.last_name, m.email,
           m.membership_status, m.is_admin, c.name
  order by
    count(*) filter (where s.played_on <= current_date) desc,
    max(s.played_on) filter (where s.played_on <= current_date) desc nulls last,
    m.first_name;
$$;

-- SECURITY DEFINER: reads every member's bookings and registrations
-- regardless of the caller's RLS, so it must stay unreachable by a member.
-- Called from the admin route with the service-role client, behind
-- withAuth({ requireAdmin: true }).
revoke all on function members_played_with(uuid) from public, anon, authenticated;
grant execute on function members_played_with(uuid) to service_role;
