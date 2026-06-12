-- Allow admin users to read and update all focus_linkup_subscriptions rows so
-- that custom group requests from any member are visible and actionable in
-- the admin panel.
-- The existing "Members manage own subscriptions" policy (FOR ALL) already
-- gates member writes; these add separate SELECT/UPDATE policies for admins.

create policy "Admins read all subscriptions"
  on focus_linkup_subscriptions for select
  using (is_admin());

create policy "Admins update all subscriptions"
  on focus_linkup_subscriptions for update
  using (is_admin())
  with check (is_admin());
