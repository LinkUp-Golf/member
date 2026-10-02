-- Who actually turned up to a hosted round.
--
-- A round's roster says who was expected: members who reserved a spot through
-- the event, and members who booked the venue that day. Neither is a record of
-- who played. The host is the only person who knows that, and they're standing
-- there with the phone they upload the proof photo from — so attendance is marked
-- from the same row, at the same moment, against the same roster.
--
-- One row per member marked present. Absence is the absence of a row, not a
-- false: nobody is marked absent, they're simply not ticked, and a round nobody
-- marked has no rows rather than a table full of falses. That also makes the
-- write a replace of a set, which is what the UI is sending.
--
-- Deliberately not on hosted_event_registrations, where it would only fit half
-- the roster: a member who reached the round by booking the venue has no
-- registration row (see the seat-ownership note in CLAUDE.md), and they were at
-- the round just the same.
-- ------------------------------------------------------------

CREATE TABLE IF NOT EXISTS hosted_event_attendance (
  hosted_event_id  uuid NOT NULL REFERENCES hosted_events(id) ON DELETE CASCADE,
  member_id        uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- The host who ticked them, kept because credit is awarded off the back of
  -- these rounds and "who said so" is the first question about any of it.
  marked_by        uuid REFERENCES members(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hosted_event_id, member_id)
);

-- The roster read: every attendee of the events a host's list is showing.
CREATE INDEX IF NOT EXISTS hosted_event_attendance_event_idx
  ON hosted_event_attendance (hosted_event_id);

-- The other direction — "which rounds has this member been to" — which nothing
-- asks yet and everything about member credit eventually will.
CREATE INDEX IF NOT EXISTS hosted_event_attendance_member_idx
  ON hosted_event_attendance (member_id);

ALTER TABLE hosted_event_attendance ENABLE ROW LEVEL SECURITY;

-- The owning host and admins can read it. Writes go through the service-role
-- route (POST /api/host/events/[id]/attendance), which is also what enforces
-- that only members on the round can be marked, so there is no INSERT policy.
DROP POLICY IF EXISTS "Admins and owning host can view attendance" ON hosted_event_attendance;
CREATE POLICY "Admins and owning host can view attendance"
  ON hosted_event_attendance FOR SELECT
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1
      FROM hosted_events e
      JOIN hosts h ON h.id = e.host_id
      WHERE e.id = hosted_event_attendance.hosted_event_id
        AND h.member_id = auth.uid()
    )
  );
