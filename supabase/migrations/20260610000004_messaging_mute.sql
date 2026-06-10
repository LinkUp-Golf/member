-- Admin-controlled messaging mute for spam prevention.
-- When set, the member cannot send messages or send group-chat invitations
-- until the timestamp passes (or an admin clears it).
ALTER TABLE members
  ADD COLUMN IF NOT EXISTS messaging_muted_until timestamptz NULL;
