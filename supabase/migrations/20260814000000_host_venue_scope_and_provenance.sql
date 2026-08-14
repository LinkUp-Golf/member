-- Two related problems with how a host's venue access is represented.
--
-- 1. "No host_venues rows" meant "unrestricted". That was introduced so hosts
--    granted before venue scoping existed kept working (20260723000003), but it
--    is indistinguishable from "the grant produced nothing" — so a failed or
--    empty grant silently widened a host from one club to every club. An
--    inference that fails open is the wrong shape for an authorization rule, so
--    it becomes an explicit column.
--
-- 2. A hosts row can be created two ways: an admin approving an application, or
--    carrying the GHL `host` tag (ensureHostRow, called on every login/webhook).
--    Nothing recorded which, so admins could not tell an approved host from an
--    auto-provisioned one, and the tag path granted the broader access.

ALTER TABLE hosts
  -- true = may host at any bookable course; false = only their host_venues rows.
  ADD COLUMN IF NOT EXISTS venues_unrestricted boolean NOT NULL DEFAULT false,
  -- How the role was granted. 'application' is the reviewed path.
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'application'
    CHECK (source IN ('application', 'ghl_tag', 'admin'));

COMMENT ON COLUMN hosts.venues_unrestricted IS
  'Explicit replacement for the old "empty host_venues means no restriction" rule. Set only for hosts that predate venue scoping, or deliberately by an admin.';
COMMENT ON COLUMN hosts.source IS
  'application = admin-approved host application; ghl_tag = auto-provisioned from the GHL host tag; admin = created directly by an admin.';

-- Preserve today's behaviour exactly for existing hosts: those with no venue
-- rows are the ones currently relying on the empty-set rule, so they keep
-- unrestricted access. Those with venue rows were already restricted.
UPDATE hosts h
SET venues_unrestricted = true
WHERE NOT EXISTS (SELECT 1 FROM host_venues hv WHERE hv.host_id = h.id);

-- Existing rows predate provenance tracking. A host with no application on
-- record came from the tag path (or direct SQL); one with an application did not.
UPDATE hosts h
SET source = 'ghl_tag'
WHERE NOT EXISTS (
  SELECT 1 FROM host_applications a
  WHERE a.host_id = h.id OR (a.member_id = h.member_id AND a.status = 'approved')
);

CREATE INDEX IF NOT EXISTS hosts_status_idx ON hosts (status);

-- Suspension is now a real admin action rather than a reserved column, so drop
-- the stale note on it. The gates (middleware, withHostAuth) already consult it.
COMMENT ON COLUMN hosts.status IS
  'active = full host access; suspended = keeps the row and history but loses the workspace and has upcoming events delisted.';

-- host_venues gains an admin write path (PUT /api/admin/hosts/[id]/venues), which
-- runs service-role like every other write here, so RLS stays SELECT-only.
-- Recorded for the next reader of 20260723000003, whose comment says writes only
-- happen at approval.
-- Both hot hosted_events queries filter on status and order by event_date — the
-- admin credit queue and the member browse list. Only single-column indexes
-- existed, so each did a scan then a sort.
CREATE INDEX IF NOT EXISTS hosted_events_status_date_idx
  ON hosted_events (status, event_date);

COMMENT ON TABLE host_venues IS
  'Approved (host, course) pairs. Written by host-application approval, by admin venue management, and by course approval back-granting hosts who already hold an event there. A course may be approval_status=pending — that is a club the host proposed and an admin has not set up yet.';
