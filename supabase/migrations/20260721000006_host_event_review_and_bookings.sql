-- Two changes to hosted events:
--
-- 1. Admin review before an event goes live. Previously a host published
--    straight to 'upcoming'; now publishing submits for review
--    (draft -> pending_review -> upcoming). Credit approval after the event is
--    unchanged and still separate.
--
-- 2. An event can be created FROM one of the host's existing bookings. The
--    course/date/tee time then come from that real booking, and the number of
--    spots offered can't exceed the seats the booking actually holds — so a
--    host can't advertise more places than they hold at the course.

-- ---- pending_review status ---------------------------------------------
-- The status CHECK was declared inline on CREATE TABLE, so Postgres named it
-- hosted_events_status_check.
ALTER TABLE hosted_events
  DROP CONSTRAINT IF EXISTS hosted_events_status_check;
ALTER TABLE hosted_events
  ADD CONSTRAINT hosted_events_status_check CHECK (status IN (
    'draft',
    'pending_review',
    'upcoming',
    'completed',
    'cancelled',
    'pending_credit_approval',
    'credits_awarded'
  ));

-- ---- Review outcome + booking source ------------------------------------
ALTER TABLE hosted_events
  -- Why an admin sent the event back; distinct from cancellation_reason, which
  -- is the host cancelling their own event.
  ADD COLUMN IF NOT EXISTS rejection_reason text,
  ADD COLUMN IF NOT EXISTS reviewed_by      uuid REFERENCES members(id),
  ADD COLUMN IF NOT EXISTS reviewed_at      timestamptz,
  -- The booking this event was built from, when the host listed an existing
  -- tee time rather than proposing a new one. SET NULL keeps the event if the
  -- booking row is later removed.
  ADD COLUMN IF NOT EXISTS source_booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL;

-- One live listing per booking. Partial so cancelled events release the
-- booking for re-listing, and so the many events with no booking source are
-- unconstrained. Race-safe backstop to the app-level check.
CREATE UNIQUE INDEX IF NOT EXISTS hosted_events_source_booking_unique
  ON hosted_events (source_booking_id)
  WHERE source_booking_id IS NOT NULL AND status <> 'cancelled';

CREATE INDEX IF NOT EXISTS hosted_events_source_booking_idx
  ON hosted_events (source_booking_id);

-- ---- RLS: an event awaiting review is not public ------------------------
-- Members may browse published events only; drafts AND events still in review
-- stay visible to the owning host and admins.
DROP POLICY IF EXISTS "View hosted events" ON hosted_events;
CREATE POLICY "View hosted events"
  ON hosted_events FOR SELECT
  USING (
    is_admin()
    OR status NOT IN ('draft', 'pending_review')
    OR EXISTS (
      SELECT 1 FROM hosts h
      WHERE h.id = hosted_events.host_id AND h.member_id = auth.uid()
    )
  );
