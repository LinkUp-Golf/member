-- Hosts: members who organise their own golf events (a course + date + limited
-- spots at a member guest rate) and earn credits once an event has occurred and
-- an admin has approved the proof. A member "is a host" iff a hosts row exists
-- for them — there is no separate role column, mirroring how a referral_partners
-- row grants /partner and members.is_admin grants /admin.
--
-- All hosts are members (unlike referral_partners, which also has external
-- affiliates), so member_id is NOT NULL and uniquely owned.
CREATE TABLE IF NOT EXISTS hosts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- Display name the host operates under (their brand / how events are
  -- attributed). Defaults to the member's own name at approval time.
  name        text NOT NULL,
  -- Reserved for a future admin "suspend host" action. The role gate is the
  -- row's existence today; status is not yet consulted by the gates.
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_by  uuid REFERENCES members(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- A member owns exactly one host row.
ALTER TABLE hosts
  DROP CONSTRAINT IF EXISTS hosts_member_unique;
ALTER TABLE hosts
  ADD CONSTRAINT hosts_member_unique UNIQUE (member_id);

CREATE INDEX IF NOT EXISTS hosts_member_idx ON hosts (member_id);

DROP TRIGGER IF EXISTS hosts_updated_at ON hosts;
CREATE TRIGGER hosts_updated_at
  BEFORE UPDATE ON hosts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE hosts ENABLE ROW LEVEL SECURITY;

-- Owners read their own host row (nav role check, workspace); admins read all.
-- Writes (grant on approval, suspend) go through service-role API routes, which
-- bypass RLS — so there is deliberately no INSERT/UPDATE policy.
DROP POLICY IF EXISTS "Admins and owners can view hosts" ON hosts;
CREATE POLICY "Admins and owners can view hosts"
  ON hosts FOR SELECT
  USING (is_admin() OR member_id = auth.uid());
