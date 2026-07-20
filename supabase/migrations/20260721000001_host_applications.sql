-- Members apply to become a host. Admins review applications and, on approval, a
-- hosts row is created for that member — which is what grants the host role
-- (see 20260721000000_hosts.sql). Rejections carry a reason; both outcomes
-- notify the member. Mirrors referral_partner_applications exactly.
--
-- NOTE: this table references members twice — member_id (the applicant) and
-- reviewed_by (the admin). That makes a bare PostgREST `members(...)` embed
-- ambiguous, so queries must name the constraint:
--   member:members!host_applications_member_id_fkey(...)
CREATE TABLE IF NOT EXISTS host_applications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id         uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- Host name the applicant proposes to operate under.
  name              text,
  -- The applicant's pitch — the kind of events they'd run. Shown to the admin.
  description       text NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
  -- Set on approval; the host row the application produced.
  host_id           uuid REFERENCES hosts(id) ON DELETE SET NULL,
  rejection_reason  text,
  reviewed_by       uuid REFERENCES members(id),
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One open application per member — re-applying while pending is a no-op rather
-- than a duplicate row. The race-safe backstop to the app-level check.
CREATE UNIQUE INDEX IF NOT EXISTS host_applications_pending_unique
  ON host_applications (member_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS host_applications_status_idx
  ON host_applications (status);
CREATE INDEX IF NOT EXISTS host_applications_member_idx
  ON host_applications (member_id);

DROP TRIGGER IF EXISTS host_applications_updated_at ON host_applications;
CREATE TRIGGER host_applications_updated_at
  BEFORE UPDATE ON host_applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE host_applications ENABLE ROW LEVEL SECURITY;

-- Members read their own application history; admins read all. Writes go through
-- service-role API routes, so there is deliberately no INSERT/UPDATE policy.
DROP POLICY IF EXISTS "Members can view own host applications" ON host_applications;
CREATE POLICY "Members can view own host applications"
  ON host_applications FOR SELECT
  USING (member_id = auth.uid() OR is_admin());
