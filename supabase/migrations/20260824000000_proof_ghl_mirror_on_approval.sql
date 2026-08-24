-- The GHL copy of a proof photo is made when the credit is approved, not when
-- the host uploads.
--
-- No schema change — both columns already exist and stay nullable. What changes
-- is when they get filled in, and the old comments described the upload as the
-- moment, which is now wrong in a way that would mislead whoever reads the
-- schema next.
--
-- Why it moved: a proof is a draft until an admin decides on it. A host can
-- replace the photo while the event waits for review, and again if it's sent
-- back — and each replacement deletes the previous row and its blob. Mirroring
-- on upload therefore put every attempt into the GHL media library permanently,
-- including the superseded ones, with nothing left in LinkUp pointing at them.
-- Mirroring on approval means one file per credited round, and it is the photo
-- the credit was actually paid on.
--
-- A consequence worth knowing: a proof that is never approved has no GHL copy at
-- all, which is the intended outcome rather than a gap.

COMMENT ON COLUMN hosted_event_proofs.ghl_media_id IS
  'fileId returned by POST /medias/upload-file, written when an admin approves '
  'the event''s credit. NULL until then, and permanently NULL for a proof that '
  'was replaced, refused, or whose mirror failed.';

COMMENT ON COLUMN hosted_event_proofs.ghl_media_url IS
  'Public URL of the GHL copy, written on credit approval. The app always '
  'renders image_url (Supabase); this is for finding the file in GHL.';
