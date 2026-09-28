-- The GHL availability schedule behind a host's venue.
--
-- A venue's calendar offers members whatever slots the users staffing it are
-- available for, and a GHL user's default availability is every weekday, all
-- day. A host is at the club on the handful of dates they listed, at one tee
-- time each — so a freshly staffed calendar was offering tee times on days
-- nobody would be there.
--
-- Setting that availability is a POST to GHL's /calendars/schedules, which
-- creates a named schedule for one user on one calendar. This column holds the
-- id it returns, so the next time the host's dates change we replace that
-- schedule instead of creating a second one alongside it. One per host per
-- venue, which is exactly this table's grain.
--
-- Nullable and not backfilled: null means no schedule has been written yet,
-- which is every existing grant, plus any where GHL refused. Nothing depends on
-- it — it makes the calendar offer the right days, not the grant valid.

ALTER TABLE host_venues
  ADD COLUMN IF NOT EXISTS ghl_schedule_id text;

COMMENT ON COLUMN host_venues.ghl_schedule_id IS
  'GHL availability schedule id for this host on this venue''s calendar. Null = not written yet.';
