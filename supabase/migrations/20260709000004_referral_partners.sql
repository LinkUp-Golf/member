-- Referral Partners: external affiliates who refer members and non-members to
-- LinkUp and earn a commission (percentage of the membership fee) when a
-- referral converts to a paying member. Managed by admins on the (previously
-- unused) "Referral Pipeline" admin page. Partners carry a unique code and a
-- commission percentage that are written onto each referred GHL contact as
-- custom fields (see referral_partner_links).
CREATE TABLE IF NOT EXISTS referral_partners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  code        text NOT NULL,
  percentage  numeric(5,2) NOT NULL DEFAULT 10 CHECK (percentage >= 0 AND percentage <= 100),
  created_by  uuid REFERENCES members(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The code is the affiliate's public identifier and is pushed to GHL contacts,
-- so it must be unique across partners. Mirrors the courses_*_unique pattern —
-- the API pre-checks, and this constraint is the race-safe backstop.
ALTER TABLE referral_partners
  DROP CONSTRAINT IF EXISTS referral_partners_code_unique;
ALTER TABLE referral_partners
  ADD CONSTRAINT referral_partners_code_unique UNIQUE (code);

CREATE INDEX IF NOT EXISTS referral_partners_code_idx ON referral_partners (code);

ALTER TABLE referral_partners ENABLE ROW LEVEL SECURITY;

-- Admin-only feature. SELECT via is_admin() so the admin page's browser
-- Supabase client can read directly (matching the existing /admin/referrals
-- page). All writes go through service-role API routes, which bypass RLS.
DROP POLICY IF EXISTS "Admins can view referral partners" ON referral_partners;
CREATE POLICY "Admins can view referral partners"
  ON referral_partners FOR SELECT
  USING (is_admin());
