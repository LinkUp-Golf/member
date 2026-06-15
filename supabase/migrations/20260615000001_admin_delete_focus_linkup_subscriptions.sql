-- Allow admin users to delete any focus_linkup_subscriptions row so that
-- custom group requests can be fully moderated (CRUD) from the admin panel.
-- Admins already have SELECT/UPDATE via the policies added in
-- 20260612000002_admin_read_focus_linkup_subscriptions.sql; this adds DELETE.
-- Member deletes remain gated by the existing "Members manage own
-- subscriptions" (FOR ALL) policy.

create policy "Admins delete all subscriptions"
  on focus_linkup_subscriptions for delete
  using (is_admin());
