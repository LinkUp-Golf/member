-- Move a whole booking group to another day (and tee time), atomically.
--
-- An admin can move a round from the bookings list. A group is every row the
-- booker made in one go — their own seat and one per player — so it moves as
-- one: moving a single row would leave a player on a different day from the
-- people they booked with.
--
-- The new day is checked the way create_bookings_for_day checks a new booking:
-- under the same advisory lock, against the venue's daily cap and any curated
-- tee time's seats. The moved rows are left out of the count, so a group can be
-- moved to another tee time on the day it's already on. Cancelled and
-- waitlisted rows don't hold a seat, so they move without counting.
--
-- The reminder and survey flags are cleared, because they were about the old
-- tee time. That can't fire anything early: the reminders cron only sends
-- within a few minutes of each target, so a target the new date has already
-- passed is simply never reached.
--
-- Raises DAY_FULL:<remaining> / SLOT_FULL:<HH:MI>:<remaining>, like the create
-- path, and returns the moved rows.
create or replace function move_booking_group(
  p_ids       uuid[],
  p_course_id uuid,
  p_date      date,
  p_tee_time  time,
  p_capacity  int
) returns setof bookings
language plpgsql
as $$
declare
  v_needed    int;
  v_used      int;
  v_seats     int;
  v_slot_used int;
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_course_id::text || '|' || p_date::text, 0)
  );

  select count(*) into v_needed
  from bookings
  where id = any(p_ids)
    and status not in ('cancelled', 'waitlist');

  select count(*) into v_used
  from bookings
  where course_id    = p_course_id
    and booking_date = p_date
    and status not in ('cancelled', 'waitlist')
    and not (id = any(p_ids));

  if v_used + v_needed > p_capacity then
    raise exception 'DAY_FULL:%', greatest(p_capacity - v_used, 0)
      using errcode = 'P0001';
  end if;

  select seats into v_seats
  from course_custom_slots
  where course_id = p_course_id
    and slot_date = p_date
    and tee_time  = p_tee_time;

  if found then
    select count(*) into v_slot_used
    from bookings
    where course_id    = p_course_id
      and booking_date = p_date
      and tee_time     = p_tee_time
      and status not in ('cancelled', 'waitlist')
      and not (id = any(p_ids));

    if v_slot_used + v_needed > v_seats then
      raise exception 'SLOT_FULL:%:%',
        to_char(p_tee_time, 'HH24:MI'),
        greatest(v_seats - v_slot_used, 0)
        using errcode = 'P0001';
    end if;
  end if;

  return query
  update bookings
     set booking_date       = p_date,
         tee_time           = p_tee_time,
         reminder_7d_sent   = false,
         reminder_3d_sent   = false,
         reminder_6h_sent   = false,
         survey_prompt_sent = false
   where id = any(p_ids)
  returning *;
end;
$$;
