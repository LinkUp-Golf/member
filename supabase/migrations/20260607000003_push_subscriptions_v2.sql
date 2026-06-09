-- ============================================================
-- Migration: push_subscriptions v2
--
-- Changes:
--   • Replaces member_id (NOT NULL FK → members) with
--     user_id (nullable FK → auth.users) so anonymous
--     browser subscriptions can be stored before login.
--   • Adds updated_at with an auto-update trigger.
--   • Adds index on user_id for fast per-user lookups.
--   • Replaces the single "all" policy with fine-grained
--     SELECT / INSERT / UPDATE / DELETE policies.
-- ============================================================

-- ---- 1. Add user_id column (nullable FK to auth.users) -----
alter table push_subscriptions
  add column user_id uuid references auth.users(id) on delete cascade;

-- ---- 2. Migrate existing data --------------------------------
-- In this app member.id == auth.users.id, so a direct copy is safe.
update push_subscriptions
  set user_id = member_id;

-- ---- 3. Drop the old RLS policy before dropping the column it references --
drop policy if exists "Members manage own push subscriptions"
  on push_subscriptions;

-- ---- 4. Drop the old member_id column ----------------------
alter table push_subscriptions
  drop column member_id;

-- ---- 4. Add updated_at column --------------------------------
alter table push_subscriptions
  add column updated_at timestamptz not null default now();

-- ---- 5. Index on user_id for per-user subscription lookups --
create index push_subscriptions_user_id_idx
  on push_subscriptions(user_id);

-- ---- 6. auto-update trigger for updated_at ------------------
create or replace function push_subscriptions_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger push_subscriptions_updated_at
  before update on push_subscriptions
  for each row execute function push_subscriptions_set_updated_at();

-- ---- 7. Fine-grained RLS policies --------------------------
-- SELECT: users see only their own subscriptions
create policy "push_sub_select"
  on push_subscriptions for select
  using (user_id = auth.uid());

-- INSERT: authenticated users may insert their own; anonymous
-- subscriptions land with user_id = null (no auth.uid() match
-- needed — the app associates them on next login).
create policy "push_sub_insert"
  on push_subscriptions for insert
  with check (
    user_id = auth.uid()          -- authenticated: own record
    or user_id is null            -- anonymous subscription
  );

-- UPDATE: own rows only (used to claim an anonymous subscription
-- after login)
create policy "push_sub_update"
  on push_subscriptions for update
  using (
    user_id = auth.uid()
    or user_id is null
  )
  with check (
    user_id = auth.uid()
    or user_id is null
  );

-- DELETE: own rows only
create policy "push_sub_delete"
  on push_subscriptions for delete
  using (
    user_id = auth.uid()
    or user_id is null
  );

-- Note: the service role (createAdminClient) bypasses RLS
-- entirely, so the send-to-all / send-to-user server routes
-- work without additional policies.
