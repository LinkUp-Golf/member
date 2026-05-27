-- ============================================================
-- Add image_url / video_url to announcements and promotions,
-- and create the post-media storage bucket with admin-only
-- upload/delete policies.
-- ============================================================

-- ---- Schema changes -----------------------------------------

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS video_url text;

ALTER TABLE promotions
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS video_url text;

-- ---- Storage bucket -----------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'post-media',
  'post-media',
  true,
  52428800,   -- 50 MB per file
  ARRAY[
    'image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif',
    'video/mp4', 'video/webm', 'video/quicktime', 'video/mov'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- ---- Storage RLS policies -----------------------------------

CREATE POLICY "Admins can upload post media"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'post-media' AND
    EXISTS (SELECT 1 FROM members WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins can update post media"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'post-media' AND
    EXISTS (SELECT 1 FROM members WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins can delete post media"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'post-media' AND
    EXISTS (SELECT 1 FROM members WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Public can read post media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'post-media');
