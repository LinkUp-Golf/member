-- Who an announcement is emailed to, when it isn't everybody.
--
-- A broadcast pushes and emails every active member of the community, which is
-- right for news and wrong for anything aimed at a group: a partner offer for
-- the members who asked about partners, a change of plan for the eight people
-- it affects. The post itself is still the community's — it appears in the feed
-- and the in-app notification goes out as before — but the email can now be
-- narrowed.
--
-- Two ways to name the group, because admins already think in both:
--   email_tags        GHL contact tags. Whoever in this community carries any
--                     of them. A tag is how the rest of the business segments
--                     people, so a campaign tag works here without anyone
--                     rebuilding the segment by hand.
--   email_member_ids  people, chosen by name.
--
-- Stored on the row rather than being a property of the send, for two reasons:
-- a post held for moderation is emailed when it's approved, which can be days
-- later and in a different request, and afterwards this is the only record of
-- who it went to.
--
-- Both empty — the default, and what every existing row has — means everybody,
-- exactly as before.
--
-- text[] and uuid[] rather than join tables: this is a record of a choice made
-- once, not a relationship anything queries from the other end. Same reasoning
-- as host_applications.requested_course_ids.

ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS email_tags       text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS email_member_ids uuid[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN announcements.email_tags IS
  'GHL contact tags; members of this course carrying any of them are emailed. Empty with email_member_ids means everyone.';
COMMENT ON COLUMN announcements.email_member_ids IS
  'Members chosen by name to be emailed. Empty with email_tags means everyone.';
