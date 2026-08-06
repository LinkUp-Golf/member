-- Hosted events have no draft state.
--
-- An event now goes live the moment the host creates it. There is no "save for
-- later", no publish step, and nothing sitting invisible waiting on a decision.
-- The admin counterweight is unchanged in spirit but changes in destination: an
-- admin who sees a listing that shouldn't be there takes it down, and a taken
-- down event is cancelled rather than returned to a draft the host republishes.
--
-- 'draft' is dropped from the CHECK so nothing can re-enter it, mirroring how
-- 'pending_review' was retired in 20260723000000_remove_host_event_approval_gate.

-- ---- 1. Empty the draft bucket ------------------------------------------
-- Two kinds of draft exist today, and they don't deserve the same fate.
--
-- A draft an admin unpublished (rejection_reason is set) was deliberately taken
-- off the member list. Publishing it here would silently undo that decision, so
-- it becomes cancelled — the same end state the new takedown writes.
UPDATE hosted_events
   SET status = 'cancelled'
 WHERE status = 'draft'
   AND rejection_reason IS NOT NULL;

-- Everything else is a draft the host simply hadn't published: their own saved
-- draft, or one parked because the club wasn't on LinkUp yet. Under the new
-- rule those would have gone live on creation, so they go live now — unless
-- the date has already passed, in which case there's nothing left to publish.
UPDATE hosted_events
   SET status = 'upcoming'
 WHERE status = 'draft'
   AND event_date >= CURRENT_DATE;

UPDATE hosted_events
   SET status = 'cancelled',
       cancellation_reason = COALESCE(cancellation_reason, 'This draft was never published and its date has passed.')
 WHERE status = 'draft';

-- ---- 2. Retire the status -----------------------------------------------
-- The column defaulted to 'draft'; an insert that doesn't name a status would
-- now violate the CHECK, so the default moves with it.
ALTER TABLE hosted_events
  ALTER COLUMN status SET DEFAULT 'upcoming';

ALTER TABLE hosted_events
  DROP CONSTRAINT IF EXISTS hosted_events_status_check;
ALTER TABLE hosted_events
  ADD CONSTRAINT hosted_events_status_check CHECK (status IN (
    'upcoming',
    'completed',
    'cancelled',
    'pending_credit_approval',
    'credits_awarded'
  ));

-- ---- 3. SELECT policy: nothing is private any more -----------------------
-- The policy existed to hide drafts from everyone but the owning host and
-- admins. With no drafts, every remaining status is one members may see, and
-- the host/admin carve-outs are dead weight. Writes still go through
-- service-role routes, which is where the real authorisation lives.
DROP POLICY IF EXISTS "View hosted events" ON hosted_events;
CREATE POLICY "View hosted events"
  ON hosted_events FOR SELECT
  USING (true);
