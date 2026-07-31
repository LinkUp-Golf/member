-- Two flags on bookings, for two different questions the survey asks.

-- 1. "Should this round ever be surveyed automatically?"
--
-- Rounds that had already finished when the survey shipped are not chased: no
-- push, no popup on next app open. A member who wants to rate one does it by
-- hand from My Bookings — POST /api/surveys ignores this flag entirely, so
-- history stays rateable, it just isn't pushed at anyone.
--
-- Defaults to true, so every booking made from here on — and every round that
-- was still upcoming when this ran — is prompted normally.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS survey_auto_prompt boolean NOT NULL DEFAULT true;

-- 2. "Has the push for this round already gone out?"
--
-- The cron's idempotency guard, mirroring the reminder_7d_sent /
-- reminder_3d_sent / reminder_6h_sent flags it already keeps on this table.
-- Distinct from booking_surveys: the push is sent *before* a response exists,
-- so "asked" and "answered" are genuinely different states.
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS survey_prompt_sent boolean NOT NULL DEFAULT false;

-- Everything already finished is exempt from automatic prompting. Without
-- this, the first cron run would treat a fortnight of past rounds as newly due
-- and fire that many notifications at once, and the in-app prompt would greet
-- returning members with a stack of modals for rounds they'd long forgotten.
--
-- Rounds dated today are deliberately left eligible: they were "upcoming" when
-- this ran, which is exactly the case that should still be prompted.
UPDATE bookings
   SET survey_auto_prompt = false
 WHERE booking_date < CURRENT_DATE;

-- Matches the cron's scan: finished rounds that are eligible and not yet
-- prompted. Partial, so prompted and exempt rows drop out of the index
-- entirely and it stays small however many bookings accumulate.
CREATE INDEX IF NOT EXISTS bookings_survey_pending_idx
  ON bookings (booking_date)
  WHERE survey_prompt_sent = false AND survey_auto_prompt = true;
