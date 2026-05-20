-- ============================================================
-- Admin panel feature columns
-- Adds: member warning/suspension tracking, booking admin notes,
--       guest access revoked status, and audit log table.
-- ============================================================

-- ---- members: warning count and suspension window -----------
alter table members
  add column if not exists warning_count    int not null default 0,
  add column if not exists suspended_until  timestamptz;

-- ---- bookings: admin-only notes ----------------------------
alter table bookings
  add column if not exists admin_notes  text;

-- ---- guest_access_requests: revoked status -----------------
-- Extend the existing enum to include 'revoked'
alter type guest_access_status add value if not exists 'revoked';

-- ---- admin_audit_log ---------------------------------------
create table if not exists admin_audit_log (
  id           uuid primary key default gen_random_uuid(),
  admin_id     uuid not null references members(id) on delete set null,
  action       text not null,
  target_type  text not null,
  target_id    uuid not null,
  payload      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

-- Index for fast lookups by target (e.g. show history for a member)
create index if not exists idx_admin_audit_log_target
  on admin_audit_log (target_type, target_id);

-- Index for admin activity feed
create index if not exists idx_admin_audit_log_admin
  on admin_audit_log (admin_id, created_at desc);

-- ---- RLS: audit log is admin-read-only ---------------------
alter table admin_audit_log enable row level security;

create policy "Admins can read audit log"
  on admin_audit_log for select
  using (
    exists (
      select 1 from members
      where members.id = auth.uid()
        and members.is_admin = true
    )
  );

-- No insert/update/delete policies — writes go through service role only
