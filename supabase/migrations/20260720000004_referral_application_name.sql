-- The referral-partner application now collects two fields: the name the
-- applicant wants to operate under as a partner, and a free-text description
-- (renamed from the earlier "motivation"). The name becomes the default
-- referral_partners.name when the application is approved.

ALTER TABLE referral_partner_applications
  ADD COLUMN IF NOT EXISTS name text;

-- Rename motivation → description, guarded so the migration is safe to re-run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'referral_partner_applications' AND column_name = 'motivation'
  ) THEN
    ALTER TABLE referral_partner_applications RENAME COLUMN motivation TO description;
  END IF;
END $$;

COMMENT ON COLUMN referral_partner_applications.name IS
  'Referral name the applicant proposes; default partner name on approval.';
