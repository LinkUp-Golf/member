-- Post-round satisfaction survey: one 5-star response per booking, collected
-- shortly after the round is scheduled to finish.
--
-- The prompt time isn't stored — it's derived from the booking itself
-- (booking_date + tee_time in the course's timezone + courses.meeting_duration_mins
-- + a short grace period; see src/lib/surveys/due.ts). Storing a due_at column
-- would go stale the moment a booking is rescheduled or a course's round length
-- changes, and it would need backfilling for every existing booking.
--
-- member_id / course_id are denormalised off the booking so the admin review
-- list can filter and aggregate without joining through bookings, and so a
-- response survives as a record of what was rated even if the booking row is
-- reshaped later. booking_id is the identity: one response per booking.

CREATE TABLE IF NOT EXISTS booking_surveys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES courses(id),
  -- Always answered — the star rating is the one required field.
  rating      smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  -- False when the member ticks "I didn't make it to this round". These are
  -- excluded from course rating averages: they rate the experience around a
  -- round the member never played, not the round itself.
  attended    boolean NOT NULL DEFAULT true,
  -- Optional free text. Offered to everyone, but surfaced prominently for
  -- no-shows, where the reason is the useful part.
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Admin review list: newest first, optionally narrowed to one course.
CREATE INDEX IF NOT EXISTS booking_surveys_course_created_idx
  ON booking_surveys (course_id, created_at DESC);

-- "Which of this member's bookings are still unanswered" — the pending-survey
-- lookup runs on every app open, so it gets its own index.
CREATE INDEX IF NOT EXISTS booking_surveys_member_idx
  ON booking_surveys (member_id, created_at DESC);

ALTER TABLE booking_surveys ENABLE ROW LEVEL SECURITY;

-- A member can read their own responses; admins read all of them for the
-- review page. Writes go through POST /api/surveys (service role), which is
-- where "is this booking yours, finished, and unanswered?" is enforced — so
-- there is deliberately no INSERT/UPDATE policy.
DROP POLICY IF EXISTS "Members read own survey responses" ON booking_surveys;
CREATE POLICY "Members read own survey responses"
  ON booking_surveys FOR SELECT
  USING (member_id = auth.uid() OR is_admin());
