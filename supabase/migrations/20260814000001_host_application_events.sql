-- Rounds an applicant proposes as part of applying to become a host.
--
-- The "How it works" model on /more/host has always described this as one flow:
-- step 1 tell us the club, step 2 give us the dates, time, guests and cost per
-- player, step 3 we put those on the LinkUp calendar. But the application only
-- ever captured steps 1's club — the dates and pricing had nowhere to go, so an
-- approved host had to re-enter everything in the event form before anything
-- existed. These rows are step 2.
--
-- Deliberately a separate table rather than columns on host_applications: the
-- model is "one date or several", so it's 1:N.
--
-- Columns mirror hosted_events exactly (tee_time free text, total_spots 1-200,
-- member_guest_rate numeric(10,2)) because on approval each row becomes a real
-- hosted_events row — a shape mismatch here would surface as a failed approval.
CREATE TABLE IF NOT EXISTS host_application_events (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id    uuid NOT NULL REFERENCES host_applications(id) ON DELETE CASCADE,
  -- The venue. May be a `pending` course (a club the applicant proposed), which
  -- is the whole point of accepting pending venues on the application.
  course_id         uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  event_date        date NOT NULL,
  -- Free text, matching hosted_events: "8:30 AM", "morning", or NULL for no
  -- fixed time.
  tee_time          text,
  total_spots       integer NOT NULL CHECK (total_spots BETWEEN 1 AND 200),
  member_guest_rate numeric(10,2) NOT NULL CHECK (member_guest_rate >= 0 AND member_guest_rate <= 100000),
  dinner            boolean NOT NULL DEFAULT false,
  -- Set when approval turned this proposal into a live event. Also the
  -- idempotency guard: a row that already has one is never created twice.
  hosted_event_id   uuid REFERENCES hosted_events(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS host_application_events_application_idx
  ON host_application_events (application_id);
CREATE INDEX IF NOT EXISTS host_application_events_course_idx
  ON host_application_events (course_id);

ALTER TABLE host_application_events ENABLE ROW LEVEL SECURITY;

-- The applicant reads their own proposals; admins read all. Writes go through
-- service-role API routes (apply, approve), matching host_applications itself —
-- so there is deliberately no INSERT/UPDATE policy.
DROP POLICY IF EXISTS "View own host application events" ON host_application_events;
CREATE POLICY "View own host application events"
  ON host_application_events FOR SELECT
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1 FROM host_applications a
      WHERE a.id = host_application_events.application_id
        AND a.member_id = auth.uid()
    )
  );

COMMENT ON TABLE host_application_events IS
  'Rounds proposed on a host application. Become real hosted_events rows on approval, for the venues the approval actually granted.';
