-- What a host asked for when proposing a club we don't have yet.
--
-- The host event form's "New LinkUp" tab names a club, the dates they want to
-- run, how many slots a day and what they'd charge a guest. None of that can
-- become hosted_events yet: there's no GHL calendar behind a pending course, so
-- there are no real open days to attach a round to, and the dates arrive as
-- free text ("every Saturday in October") rather than as dates.
--
-- So it lands here, on the pending course row an admin already reviews in the
-- Courses queue, next to requested_by. Once the admin sets the club up they
-- have the host's ask in front of them rather than in an email.
--
-- Free text on purpose. Parsing a host's schedule into dates and being wrong is
-- worse than showing an admin exactly what the host typed.
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS requested_event_dates text,
  ADD COLUMN IF NOT EXISTS requested_slots_per_day integer,
  ADD COLUMN IF NOT EXISTS requested_member_guest_rate numeric(10,2);

-- Same bounds the form applies, so a bad row can't be written round the back.
ALTER TABLE courses
  DROP CONSTRAINT IF EXISTS courses_requested_slots_per_day_check;
ALTER TABLE courses
  ADD CONSTRAINT courses_requested_slots_per_day_check
  CHECK (requested_slots_per_day IS NULL OR requested_slots_per_day BETWEEN 1 AND 200);

ALTER TABLE courses
  DROP CONSTRAINT IF EXISTS courses_requested_member_guest_rate_check;
ALTER TABLE courses
  ADD CONSTRAINT courses_requested_member_guest_rate_check
  CHECK (requested_member_guest_rate IS NULL OR requested_member_guest_rate >= 0);
