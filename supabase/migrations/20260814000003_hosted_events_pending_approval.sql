-- Hosted events wait for an admin before members can see them.
--
-- A host publishing an event used to put it straight into 'upcoming' — live,
-- browsable and joinable the same second. That skipped the work that actually
-- makes an event bookable: the LinkUp team has to create the GHL calendar, put
-- the host on it, and wire the event to the booking and payment side. Until
-- that exists a member could reserve a spot in a round with no calendar behind
-- it, and the money had nowhere to go.
--
-- So 'pending_approval' goes in front: a host creates, an admin approves, and
-- approval is what makes it 'upcoming'.
--
-- NOTE FOR WHOEVER READS THIS NEXT: this is the third publish gate on this
-- table. 'pending_review' was removed in 20260723000000 and 'draft' in
-- 20260806000000, both on the grounds that hosts shouldn't wait to publish.
-- This one is not that decision reversed — it exists because of the GHL setup
-- step, which neither of the earlier gates was about. If the calendar work ever
-- becomes automatic, this gate has no reason to exist either.

-- ---- 1. Allow the new status --------------------------------------------
ALTER TABLE hosted_events
  DROP CONSTRAINT IF EXISTS hosted_events_status_check;
ALTER TABLE hosted_events
  ADD CONSTRAINT hosted_events_status_check CHECK (status IN (
    'pending_approval',
    'upcoming',
    'completed',
    'cancelled',
    'pending_credit_approval',
    'credits_awarded'
  ));

-- Anything created without an explicit status is a host's new event, so the
-- safe default is the gated one. Every existing row keeps the status it has —
-- events already live stay live, and nobody's published round is pulled back.
ALTER TABLE hosted_events
  ALTER COLUMN status SET DEFAULT 'pending_approval';

-- ---- 2. Keep pending events off the member list --------------------------
-- The SELECT policy was opened to `true` when drafts were retired, on the
-- reasoning that every remaining status was one members may see. That stops
-- being true here. Member browse goes through a service-role route that filters
-- on status, so this is defence in depth rather than the only guard — but a
-- policy that says "everything is public" next to a status that isn't would be
-- a trap for the next person writing a client-side query.
DROP POLICY IF EXISTS "View hosted events" ON hosted_events;
CREATE POLICY "View hosted events"
  ON hosted_events FOR SELECT
  USING (
    status <> 'pending_approval'
    OR EXISTS (
      SELECT 1 FROM hosts h
       WHERE h.id = hosted_events.host_id
         AND h.member_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM members m
       WHERE m.id = auth.uid()
         AND m.is_admin = true
    )
  );

-- ---- 3. Index the review queue ------------------------------------------
-- The admin queue reads "everything pending, oldest first". hosted_events_status_date_idx
-- (status, event_date) already covers the status lookup; this adds the created_at
-- ordering the queue actually uses.
CREATE INDEX IF NOT EXISTS hosted_events_pending_created_idx
  ON hosted_events (created_at)
  WHERE status = 'pending_approval';

COMMENT ON COLUMN hosted_events.status IS
  'pending_approval: created by the host, waiting on admin approval + GHL calendar setup. upcoming: approved and live for members. Then completed -> pending_credit_approval -> credits_awarded, or cancelled.';
