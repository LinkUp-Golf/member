-- Enable RLS on invite_tokens and block all direct client access.
--
-- The service role key (used by the admin client) bypasses RLS entirely, so
-- server-side usage is unaffected. This removes the false assumption in the
-- original schema comment and closes the PostgREST exposure of the token column.

alter table invite_tokens enable row level security;

create policy "No direct client access to invite_tokens"
  on invite_tokens
  as restrictive
  for all
  to public
  using (false)
  with check (false);
