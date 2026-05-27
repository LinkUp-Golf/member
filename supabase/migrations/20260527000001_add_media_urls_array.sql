-- Add media_urls array to announcements to support multiple uploaded files.
-- image_url / video_url are kept for backwards compatibility (first of each type).

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS media_urls text[] NOT NULL DEFAULT '{}';
