-- Additional venue contact/location details, all optional.
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS map_link text;
