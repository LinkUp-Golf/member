-- notification_log: per-member history of all push notifications sent to them.
-- member_id is the same as auth.users.id (members.id PK references auth.users).

CREATE TABLE notification_log (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id  uuid        NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type       text        NOT NULL DEFAULT 'general',
  title      text        NOT NULL,
  body       text        NOT NULL,
  data       jsonb,
  url        text,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notification_log_member_created_idx
  ON notification_log(member_id, created_at DESC);

CREATE INDEX notification_log_unread_idx
  ON notification_log(member_id, read_at)
  WHERE read_at IS NULL;

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_read_own_notifications"
  ON notification_log FOR SELECT
  USING (auth.uid() = member_id);

CREATE POLICY "members_update_own_notifications"
  ON notification_log FOR UPDATE
  USING (auth.uid() = member_id);
