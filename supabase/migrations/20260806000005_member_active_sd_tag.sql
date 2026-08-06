-- Register the 'member-active-SD' GHL tag against Aviara.
--
-- The code-level tag map (src/lib/ghl/tags.ts) already grants login, home
-- course and course_memberships off this tag. This is the other half: the
-- per-course tag list the admin screens read, which lives in the DB because an
-- admin edits it from the course editor rather than from a deploy.
--
-- Without this row the tag works everywhere that matters but the admin bookings
-- page shows a member carrying only 'member-active-SD' as having no Aviara
-- access — which invites an admin to "fix" it by re-granting a tag they already
-- hold.
--
-- Purely additive:
--   - appended, so the existing 'avi …' tags keep matching,
--   - access_tag is left alone. It mirrors required_tags[0] and is what the
--     grant/revoke buttons write, so changing it would silently switch which
--     tag new members get. That's a decision for the course editor, not a
--     migration.
--
-- Idempotent: re-running adds nothing.

UPDATE courses
SET required_tags = array_append(required_tags, 'member-active-SD')
WHERE slug = 'aviara'
  AND NOT ('member-active-SD' = ANY(COALESCE(required_tags, '{}')));
