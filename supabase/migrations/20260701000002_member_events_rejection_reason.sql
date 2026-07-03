-- Store why an admin rejected a member-submitted event, so the organizer
-- can see the reason and fix/resubmit.
ALTER TABLE member_events
  ADD COLUMN IF NOT EXISTS rejection_reason text;
