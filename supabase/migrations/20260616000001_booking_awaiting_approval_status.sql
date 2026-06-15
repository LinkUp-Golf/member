-- Non-member booking moderation.
--
-- When a member adds a non-member guest to a tee time, the guest is recorded as
-- a booking row in the 'awaiting_approval' state — no GHL appointment is created
-- yet. An admin then either "sets up" the guest (creates the GHL contact +
-- appointment and the booking moves to 'tentative') or rejects it (the booking
-- moves to 'cancelled').
--
-- ADD VALUE IF NOT EXISTS is safe to re-run.
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'awaiting_approval';
