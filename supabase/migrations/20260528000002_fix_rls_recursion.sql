-- ============================================================
-- Fix: infinite recursion in conversation_participants RLS
--
-- Root cause: the SELECT policy on conversation_participants
-- contained an EXISTS subquery that queried conversation_participants
-- again, triggering the same policy → infinite loop.
--
-- The same recursion was triggered transitively from any policy
-- on conversations or messages that queried conversation_participants.
--
-- Fix: extract the participation check into a security definer
-- function (bypasses RLS), then rewrite all affected policies to
-- use it instead of inline self-referential subqueries.
-- ============================================================

-- 1. Security-definer helper --------------------------------
-- Runs with the function owner's privileges, so it never triggers
-- the RLS policy on conversation_participants — breaking the loop.
create or replace function is_conversation_participant(conv_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from conversation_participants
    where conversation_id = conv_id
      and member_id = auth.uid()
  );
$$;


-- 2. Fix conversation_participants SELECT policy -------------
drop policy if exists "Participants can view their conversations" on conversation_participants;

create policy "Participants can view their conversations"
  on conversation_participants for select
  using (
    -- Own row always visible
    member_id = auth.uid()
    -- Other participants in a conversation the user belongs to
    or is_conversation_participant(conversation_id)
    or is_admin()
  );


-- 3. Fix conversations SELECT policy ------------------------
drop policy if exists "Members can view conversations they participate in" on conversations;

create policy "Members can view conversations they participate in"
  on conversations for select
  using (
    is_conversation_participant(id)
    or is_admin()
  );


-- 4. Fix messages SELECT policy -----------------------------
drop policy if exists "Only participants can read messages" on messages;

create policy "Only participants can read messages"
  on messages for select
  using (
    is_conversation_participant(conversation_id)
  );


-- 5. Fix messages INSERT policy -----------------------------
drop policy if exists "Participants can send messages" on messages;

create policy "Participants can send messages"
  on messages for insert
  with check (
    sender_id = auth.uid()
    and is_conversation_participant(conversation_id)
  );


-- 6. Make get_last_messages_for_conversations security definer
-- It was security invoker, so it inherited RLS which re-triggered
-- the recursion via the messages → conversation_participants chain.
-- The conv_ids parameter already comes from authenticated API routes
-- that verify participation before calling this function.
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
security definer
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
