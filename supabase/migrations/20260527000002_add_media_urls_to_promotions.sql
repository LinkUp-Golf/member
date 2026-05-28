ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS media_urls text[] NOT NULL DEFAULT '{}';
