-- Members can apply to become a referral partner. Admins review applications
-- and, on approval, a referral_partners row is created for that member — which
-- is what grants them the referral-partner role (see the member_id column
-- added below). Rejections carry a reason; both outcomes notify the member.

-- ---- Partner rows can now belong to a member ----------------------------
-- Referral partners were previously external affiliates only, with no LinkUp
-- login. A member-owned partner row is the same entity plus an owner, and the
-- owner's presence here is the role check for /partner (there is no separate
-- role column, mirroring how is_admin gates /admin).
ALTER TABLE referral_partners
  ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES members(id) ON DELETE SET NULL;

-- A member owns at most one partner row. Partial unique index rather than a
-- column constraint so the many external (member_id IS NULL) partners aren't
-- forced into a single row.
CREATE UNIQUE INDEX IF NOT EXISTS referral_partners_member_unique
  ON referral_partners (member_id) WHERE member_id IS NOT NULL;

-- ---- Applications --------------------------------------------------------
-- NOTE: this table references members twice — member_id (the applicant) and
-- reviewed_by (the admin). That makes a bare PostgREST `members(...)` embed
-- ambiguous, so queries must name the constraint:
--   member:members!referral_partner_applications_member_id_fkey(...)
CREATE TABLE IF NOT EXISTS referral_partner_applications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id         uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  -- Why they want the role — shown to the reviewing admin.
  motivation        text NOT NULL,
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
  -- Set on approval; the partner row the application produced.
  partner_id        uuid REFERENCES referral_partners(id) ON DELETE SET NULL,
  rejection_reason  text,
  reviewed_by       uuid REFERENCES members(id),
  reviewed_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One open application per member — re-applying while pending is a no-op
-- rather than a duplicate row. Mirrors event_access_requests_pending_unique.
CREATE UNIQUE INDEX IF NOT EXISTS referral_partner_applications_pending_unique
  ON referral_partner_applications (member_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS referral_partner_applications_status_idx
  ON referral_partner_applications (status);
CREATE INDEX IF NOT EXISTS referral_partner_applications_member_idx
  ON referral_partner_applications (member_id);

ALTER TABLE referral_partner_applications ENABLE ROW LEVEL SECURITY;

-- Members read their own application history; admins read all. Writes (submit,
-- approve, reject) all go through service-role API routes, which bypass RLS —
-- so there is deliberately no INSERT/UPDATE policy here.
DROP POLICY IF EXISTS "Members can view own referral partner applications"
  ON referral_partner_applications;
CREATE POLICY "Members can view own referral partner applications"
  ON referral_partner_applications FOR SELECT
  USING (member_id = auth.uid() OR is_admin());

-- ---- Partners see their own data ----------------------------------------
-- The /partner interface is the admin referral module scoped to one partner,
-- so the owning member needs read access to their partner row and referrals.
DROP POLICY IF EXISTS "Admins can view referral partners" ON referral_partners;
CREATE POLICY "Admins and owners can view referral partners"
  ON referral_partners FOR SELECT
  USING (is_admin() OR member_id = auth.uid());

DROP POLICY IF EXISTS "Admins can view referral partner links" ON referral_partner_links;
CREATE POLICY "Admins and owners can view referral partner links"
  ON referral_partner_links FOR SELECT
  USING (
    is_admin()
    OR EXISTS (
      SELECT 1 FROM referral_partners p
      WHERE p.id = referral_partner_links.referral_partner_id
        AND p.member_id = auth.uid()
    )
  );
