-- Members can request access (a GHL tag grant) to book an event/course they
-- don't currently have the required tag for. Admins review these on the new
-- Access Tags admin page; approving assigns the course's access_tag to the
-- member's GHL contact.
CREATE TABLE IF NOT EXISTS event_access_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id     uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  course_id     uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  reviewed_by   uuid REFERENCES members(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz
);

-- One pending request per member/course at a time — resubmitting while
-- already pending is a no-op, not a duplicate row.
CREATE UNIQUE INDEX IF NOT EXISTS event_access_requests_pending_unique
  ON event_access_requests (member_id, course_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS event_access_requests_course_id_idx ON event_access_requests(course_id);
CREATE INDEX IF NOT EXISTS event_access_requests_status_idx ON event_access_requests(status);

ALTER TABLE event_access_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Members can view own event access requests"
  ON event_access_requests FOR SELECT
  USING (member_id = auth.uid() OR is_admin());

CREATE POLICY "Members can create event access requests"
  ON event_access_requests FOR INSERT
  WITH CHECK (member_id = auth.uid());

CREATE POLICY "Admins can update event access requests"
  ON event_access_requests FOR UPDATE
  USING (is_admin());
