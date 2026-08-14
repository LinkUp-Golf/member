-- The host application no longer asks for a description.
--
-- What made an application reviewable turned out to be the venues and the
-- rounds proposed at them, not the prose: an admin decides on where and when
-- someone wants to host. The field is dropped from the form rather than left
-- as an unanswered box.
--
-- The column stays and only loses NOT NULL. Applications already submitted
-- carry descriptions an admin may still want to read, and deleting the column
-- would throw them away to save nothing. New rows simply leave it null, and
-- the admin review sheet hides the block when there is nothing in it.

ALTER TABLE host_applications
  ALTER COLUMN description DROP NOT NULL;

COMMENT ON COLUMN host_applications.description IS
  'Free text from the applicant. Null on applications submitted after the field was removed from the form (2026-08-14); retained for older rows.';
