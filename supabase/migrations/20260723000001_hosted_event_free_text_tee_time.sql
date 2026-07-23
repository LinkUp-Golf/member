-- Hosted-event tee time becomes free text.
--
-- Hosts were forced to pick a tee time from the course's GHL availability. That
-- rarely matched the time they'd actually arranged, so tee time is now a free
-- text field a host types (e.g. "8:30 AM", "Shotgun 9am") or leaves blank.
--
-- Events listed from a real booking still derive an "HH:MM" clock value from the
-- booking, and existing rows cast cleanly to their "HH:MM:SS" text — display
-- code (formatEventTeeTime) formats a clock value and shows anything else as-is.
ALTER TABLE hosted_events
  ALTER COLUMN tee_time TYPE text USING tee_time::text;

COMMENT ON COLUMN hosted_events.tee_time IS
  'Free-text tee time as entered by the host, or a HH:MM[:SS] clock value when listed from a booking. NULL when the event has no fixed time.';
