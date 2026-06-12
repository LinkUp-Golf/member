-- Add invite status to conversation_participants so invited members must
-- explicitly accept before joining a group chat.
-- Direct messages and the creator are always 'active'.
ALTER TABLE conversation_participants
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active'));
