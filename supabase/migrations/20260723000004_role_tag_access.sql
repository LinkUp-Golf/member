-- Non-member access via GHL role tags — part 1 of 2: the enum value.
--
-- A contact tagged 'referral-partner' or 'host' in GHL can use the app without
-- a golf membership. Such a user is a 'non_member' with no home course.
--
-- This MUST be its own migration: `ALTER TYPE ... ADD VALUE` is transaction-
-- sensitive, and Postgres won't let a newly added enum value be used in the
-- same transaction that adds it. Keeping it alone (and dropping the NOT NULL on
-- home_course_id in the next migration) guarantees each applies cleanly.
ALTER TYPE membership_status ADD VALUE IF NOT EXISTS 'non_member';
