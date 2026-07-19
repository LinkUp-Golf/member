-- Referral lists are submitted as a CSV with [name][email] columns. The raw
-- file is kept verbatim so an admin can download exactly what the partner
-- uploaded, rather than a re-rendering of our parse of it — if our parser ever
-- gets a row wrong, the original is still there to check against.
ALTER TABLE referral_partner_submissions
  ADD COLUMN IF NOT EXISTS csv_content  text,
  ADD COLUMN IF NOT EXISTS csv_filename text;

-- The partner's commission rate at the moment the list was imported.
-- Commission itself is still derived from the partner's current percentage
-- (see src/lib/referral-partners.ts); this records the rate the import was
-- actually agreed against, so a later rate change doesn't erase what the terms
-- were on the day — and makes an import under an expired rate auditable.
ALTER TABLE referral_partner_submissions
  ADD COLUMN IF NOT EXISTS applied_percentage numeric(5,2);

COMMENT ON COLUMN referral_partner_submissions.csv_content IS
  'The uploaded CSV verbatim, for admin download.';
COMMENT ON COLUMN referral_partner_submissions.applied_percentage IS
  'Partner commission rate at import time. Audit record, not the source of commission maths.';
