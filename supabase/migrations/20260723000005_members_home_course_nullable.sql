-- Non-member access via GHL role tags — part 2 of 2: the column.
--
-- A non-member (referral partner / host with no golf membership) has no home
-- course, so home_course_id must allow null. Split from the enum add in
-- 20260723000004 so neither statement can block the other. Idempotent — running
-- it when the column is already nullable is a no-op.
ALTER TABLE members
  ALTER COLUMN home_course_id DROP NOT NULL;
