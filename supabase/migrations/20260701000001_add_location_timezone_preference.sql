-- Persist timezone as a user preference, sourced from GPS coordinates
-- (server resolves lat/lng -> IANA timezone). All nullable: null timezone
-- means "not set yet, caller falls back to browser Intl detection".
ALTER TABLE member_profiles
  ADD COLUMN IF NOT EXISTS timezone text,
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS location_updated_at timestamptz;
