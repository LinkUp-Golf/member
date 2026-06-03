-- ============================================================
-- Group chat moderation: add participant roles
-- Roles: 'member' (default) | 'moderator'
-- Group creators are automatically set as moderators.
-- ============================================================

-- 1. Add role column -----------------------------------------
alter table conversation_participants
  add column if not exists role text not null default 'member'
  check (role in ('member', 'moderator'));

-- 2. Backfill: set group conversation creators as moderators -
update conversation_participants cp
set role = 'moderator'
from conversations c
where cp.conversation_id = c.id
  and cp.member_id = c.created_by
  and c.type = 'group';

-- 3. Index for fast moderator lookups ------------------------
create index if not exists conv_participants_role_idx
  on conversation_participants(conversation_id, role);
