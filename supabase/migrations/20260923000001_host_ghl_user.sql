-- The GHL user account behind a host.
--
-- Setting a host up used to be four manual steps in two systems: approve the
-- application here, then create the person a GHL user, then create the venue's
-- calendar, then put that user on it. Miss the third and fourth and the venue's
-- appointments are assigned to GHL_DEFAULT_ASSIGNEE_ID — a user with no
-- connection to the club, who is who the host's members would be booked with.
--
-- The user is now provisioned when the host is approved (ensureHostGhlUser),
-- and the venue's calendar is created staffed by it. This column is the link:
-- null means no GHL user yet, which is every host approved before this and any
-- host whose provisioning was skipped because the token has no agency scope.
-- Nothing depends on it being set — it makes the calendar better staffed, not
-- the role valid — so it stays nullable rather than backfilled.

ALTER TABLE hosts
  ADD COLUMN IF NOT EXISTS ghl_user_id text;

-- One GHL user per host. A second host pointing at the same user would put two
-- people's rounds on one person's calendar, which is the thing this is for.
DROP INDEX IF EXISTS hosts_ghl_user_idx;
CREATE UNIQUE INDEX hosts_ghl_user_idx
  ON hosts (ghl_user_id)
  WHERE ghl_user_id IS NOT NULL;

COMMENT ON COLUMN hosts.ghl_user_id IS
  'GHL user id provisioned for this host; staffs the calendars of their venues. Null = not provisioned.';
