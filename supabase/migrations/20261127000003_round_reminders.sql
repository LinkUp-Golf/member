-- Round reminders: the night before, and reminders for hosted rounds.
--
-- Members are reminded 7 days and 3 days before a round and at 8 PM the night
-- before, by push and email from the app (src/lib/bookings/reminders.ts,
-- /api/cron/booking-reminders). The night-before reminder replaces the one
-- 6 hours before the tee time, so bookings.reminder_6h_sent is no longer read;
-- it's left in place rather than dropped. Bookings gain the evening flag; a
-- hosted-round reservation, which had no reminders at all, gains all three.
--
-- Rows that exist already start unsent. That can't send anything stale: the
-- cron only sends a reminder within half an hour of its moment.

alter table bookings
  add column if not exists reminder_evening_sent boolean not null default false;

alter table hosted_event_registrations
  add column if not exists reminder_7d_sent      boolean not null default false,
  add column if not exists reminder_3d_sent      boolean not null default false,
  add column if not exists reminder_evening_sent boolean not null default false;

-- Moving a group clears its reminder flags, since they were about the old tee
-- time; the evening flag is cleared with the others. Otherwise unchanged from
-- 20261016000002.
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
     set booking_date          = p_date,
         tee_time              = p_tee_time,
         reminder_7d_sent      = false,
         reminder_3d_sent      = false,
         reminder_6h_sent      = false,
         reminder_evening_sent = false,
         survey_prompt_sent    = false
   where id = any(p_ids)
  returning *;
end;
$$;
