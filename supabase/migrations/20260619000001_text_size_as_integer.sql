-- Change text_size from enum-like text to integer (font size in px)
ALTER TABLE member_profiles
  DROP CONSTRAINT IF EXISTS member_profiles_text_size_check;

-- Drop default before type change (Postgres can't auto-cast text default to integer)
ALTER TABLE member_profiles
  ALTER COLUMN text_size DROP DEFAULT;

ALTER TABLE member_profiles
  ALTER COLUMN text_size TYPE integer
  USING CASE text_size
    WHEN 'normal' THEN 16
    WHEN 'large'  THEN 19
    WHEN 'xl'     THEN 22
    ELSE 16
  END;

ALTER TABLE member_profiles
  ALTER COLUMN text_size SET DEFAULT 16;

ALTER TABLE member_profiles
  ADD CONSTRAINT member_profiles_text_size_check
  CHECK (text_size BETWEEN 12 AND 26);
