-- ============================================================
-- Messaging Enhancements
-- Adds: conversation.updated_at, message trigger, helper RPCs,
--       duplicate-DM prevention, and optimised indexes.
-- ============================================================

-- 1. updated_at on conversations --------------------------------
alter table conversations add column if not exists updated_at timestamptz not null default now();

-- Back-fill existing rows so ordering works immediately
update conversations set updated_at = created_at where updated_at = now();

create index if not exists conversations_updated_at_idx on conversations(updated_at desc);

-- Bump conversations.updated_at every time a message is inserted
create or replace function update_conversation_timestamp()
returns trigger language plpgsql security definer as $$
begin
  update conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists on_message_created on messages;
create trigger on_message_created
  after insert on messages
  for each row execute function update_conversation_timestamp();


-- 2. Batch last-message helper ---------------------------------
-- Returns the single most-recent non-deleted message per conversation.
-- Called from /api/conversations (GET) to avoid N+1.
-- security invoker: RLS on messages still applies (users only see their convs).
create or replace function get_last_messages_for_conversations(conv_ids uuid[])
returns table (
  id               uuid,
  conversation_id  uuid,
  sender_id        uuid,
  body             text,
  created_at       timestamptz,
  edited_at        timestamptz,
  deleted_at       timestamptz,
  sender_first     text,
  sender_last      text,
  sender_avatar    text
)
language sql
security invoker
stable
as $$
  select distinct on (m.conversation_id)
    m.id,
    m.conversation_id,
    m.sender_id,
    m.body,
    m.created_at,
    m.edited_at,
    m.deleted_at,
    s.first_name  as sender_first,
    s.last_name   as sender_last,
    sp.avatar_url as sender_avatar
  from messages m
  join members s  on s.id  = m.sender_id
  left join member_profiles sp on sp.id = m.sender_id
  where m.conversation_id = any(conv_ids)
    and m.deleted_at is null
  order by m.conversation_id, m.created_at desc;
$$;


-- 3. Find existing direct conversation between two members -----
-- Returns the conversation id if one exists, else NULL.
-- Used by POST /api/conversations to prevent duplicates.
create or replace function find_direct_conversation(user1_id uuid, user2_id uuid)
returns uuid
language sql
security definer
stable
as $$
  select c.id
  from conversations c
  where c.type = 'direct'
    and (
      select count(*) from conversation_participants cp
      where cp.conversation_id = c.id
        and cp.member_id in (user1_id, user2_id)
    ) = 2
    and (
      select count(*) from conversation_participants cp
      where cp.conversation_id = c.id
    ) = 2
  limit 1;
$$;


-- 4. Additional performance indexes ----------------------------
create index if not exists messages_sender_idx on messages(sender_id);
create index if not exists messages_created_at_idx on messages(created_at desc);
create index if not exists conv_participants_member_conv_idx
  on conversation_participants(member_id, conversation_id);
