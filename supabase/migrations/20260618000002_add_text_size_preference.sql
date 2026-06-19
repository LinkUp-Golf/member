-- Add text_size preference to member_profiles
ALTER TABLE member_profiles
  ADD COLUMN IF NOT EXISTS text_size text NOT NULL DEFAULT 'normal'
    CHECK (text_size IN ('normal', 'large', 'xl'));
