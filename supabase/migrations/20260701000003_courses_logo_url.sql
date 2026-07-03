-- Every course now has a venue logo. Existing rows backfill to the bundled
-- fallback badge via the column default; the admin form enforces a real
-- upload going forward.
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS logo_url text NOT NULL DEFAULT '/course-logo-fallback.svg';
