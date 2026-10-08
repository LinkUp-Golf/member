-- Remind a host to upload proof once their round is under way.
--
-- The hosted-event-proof-reminders cron pushes and emails the host 20 minutes
-- after the round's tee time. This flag is its idempotency guard — the same
-- role survey_prompt_sent plays for bookings — so an overlapping or re-run
-- invocation can't remind the same round twice.
--
-- Every round that has already been played is marked as reminded: the reminder
-- is for a round that just went off, and a host shouldn't be woken up about one
-- from last month the first time the cron runs.
ALTER TABLE hosted_events
  ADD COLUMN IF NOT EXISTS proof_reminder_sent boolean NOT NULL DEFAULT false;

UPDATE hosted_events
   SET proof_reminder_sent = true
 WHERE event_date < current_date
    OR status IN ('pending_credit_approval', 'credits_awarded', 'cancelled');

-- The cron's own query: unreminded rounds on recent dates.
CREATE INDEX IF NOT EXISTS hosted_events_proof_reminder_idx
  ON hosted_events (event_date)
  WHERE proof_reminder_sent = false;
