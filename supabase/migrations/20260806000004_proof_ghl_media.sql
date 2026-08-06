-- Mirror host event proof photos into the GHL media library.
--
-- The proof stays in Supabase Storage — that's what the app reads and what the
-- admin credit review shows. GHL gets a copy so the photo lives alongside the
-- contact it belongs to, where the rest of the team already works.
--
-- Both columns are nullable and stay nullable. The mirror is best-effort: a
-- proof whose GHL upload failed (or that predates this change) is still a
-- perfectly valid proof, and the credit approval it exists for must not depend
-- on a third party having been reachable at upload time.

ALTER TABLE hosted_event_proofs
  ADD COLUMN IF NOT EXISTS ghl_media_id  text,
  ADD COLUMN IF NOT EXISTS ghl_media_url text;

COMMENT ON COLUMN hosted_event_proofs.ghl_media_id IS
  'fileId returned by POST /medias/upload-file. NULL when the mirror did not run or failed.';
COMMENT ON COLUMN hosted_event_proofs.ghl_media_url IS
  'Public URL of the GHL copy. The app renders image_url (Supabase); this is for finding the file in GHL.';
