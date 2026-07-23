-- Non-member access via GHL role tags.
--
-- A contact tagged 'referral-partner' or 'host' in GHL can now use the app even
-- without a golf membership. Such a user gets a member row with no home course
-- and a 'non_member' status, and is routed to their workspace.
--
--   1. Add a 'non_member' membership status (distinct from paying members, so
--      referral-conversion accounting still keys off 'active' only).
--   2. Allow members.home_course_id to be null — a non-member has no home course.

ALTER TYPE membership_status ADD VALUE IF NOT EXISTS 'non_member';

ALTER TABLE members
  ALTER COLUMN home_course_id DROP NOT NULL;
