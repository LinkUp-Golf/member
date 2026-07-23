-- Remove the host-event approval gate.
--
-- Previously a host published into 'pending_review' and an admin had to approve
-- the event before members could see it (draft -> pending_review -> upcoming).
-- That gate is gone: publishing now takes an event straight to 'upcoming'.
--
-- 1. Any event currently awaiting review is treated as approved and goes live.
-- 2. 'pending_review' is dropped from the status CHECK so nothing can re-enter it.
-- 3. The SELECT policy no longer needs to hide pending_review — only true drafts
--    stay private to the owning host and admins.
--
-- The reviewed_by / reviewed_at / rejection_reason columns are left in place
-- (harmless, and preserve history); nothing writes them anymore.

-- ---- 1. Release events stuck in review ----------------------------------
UPDATE hosted_events
  SET status = 'upcoming'
  WHERE status = 'pending_review';

-- ---- 2. Drop pending_review from the status CHECK -----------------------
ALTER TABLE hosted_events
  DROP CONSTRAINT IF EXISTS hosted_events_status_check;
ALTER TABLE hosted_events
  ADD CONSTRAINT hosted_events_status_check CHECK (status IN (
    'draft',
    'upcoming',
    'completed',
    'cancelled',
    'pending_credit_approval',
    'credits_awarded'
  ));

-- ---- 3. SELECT policy: only drafts are private --------------------------
DROP POLICY IF EXISTS "View hosted events" ON hosted_events;
CREATE POLICY "View hosted events"
  ON hosted_events FOR SELECT
  USING (
    is_admin()
    OR status <> 'draft'
    OR EXISTS (
      SELECT 1 FROM hosts h
      WHERE h.id = hosted_events.host_id AND h.member_id = auth.uid()
    )
  );
