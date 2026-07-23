-- Hosts are associated with the venues (courses) they host at.
--
-- Two parts:
--   1. host_applications.requested_course_ids — the venues an applicant asks to
--      host at (a plain uuid[]; it's a record of the request, not a live FK).
--   2. host_venues — the approved (host, course) pairs. Populated when an
--      application is approved, and consulted by the event form to pre-populate /
--      restrict the course a host can list an event at.
--
-- Hosts created before this migration have no host_venues rows; the app treats
-- an empty set as "no restriction" so they keep working exactly as before.

ALTER TABLE host_applications
  ADD COLUMN IF NOT EXISTS requested_course_ids uuid[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS host_venues (
  host_id     uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  course_id   uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (host_id, course_id)
);

CREATE INDEX IF NOT EXISTS host_venues_host_idx   ON host_venues (host_id);
CREATE INDEX IF NOT EXISTS host_venues_course_idx ON host_venues (course_id);

ALTER TABLE host_venues ENABLE ROW LEVEL SECURITY;

-- The owning host reads their own venues; admins read all. Writes go through
-- service-role API routes (approval), so there is deliberately no write policy.
DROP POLICY IF EXISTS "View host venues" ON host_venues;
CREATE POLICY "View host venues"
  ON host_venues FOR SELECT
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1 FROM hosts h
      WHERE h.id = host_venues.host_id AND h.member_id = auth.uid()
    )
  );
