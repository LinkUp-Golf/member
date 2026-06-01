-- ============================================================
-- Admin audit log table.
-- admin_id is nullable so audit records survive if the admin
-- account is later deleted (ON DELETE SET NULL).
-- ============================================================

create table if not exists admin_audit_log (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references members(id) on delete set null,
  action      text not null,
  target_type text not null,
  target_id   uuid not null,
  payload     jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists admin_audit_log_admin_idx    on admin_audit_log(admin_id);
create index if not exists admin_audit_log_target_idx   on admin_audit_log(target_type, target_id);
create index if not exists admin_audit_log_created_idx  on admin_audit_log(created_at desc);

-- If the table already exists with admin_id NOT NULL, fix it.
alter table admin_audit_log
  alter column admin_id drop not null;

-- Ensure the FK has ON DELETE SET NULL (drop + re-add if it exists).
alter table admin_audit_log
  drop constraint if exists admin_audit_log_admin_id_fkey;
alter table admin_audit_log
  add constraint admin_audit_log_admin_id_fkey
  foreign key (admin_id) references members(id) on delete set null;

-- RLS: only admins can read audit logs; writes go through service role only.
alter table admin_audit_log enable row level security;

create policy "Admins can view audit log"
  on admin_audit_log for select
  using (is_admin());
