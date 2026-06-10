-- Add focus_linkup_categories column to announcements
-- Stores the industry categories an admin targets when creating a Focus LinkUp reminder.
-- NULL or empty array = broadcast to all members (existing behaviour).
alter table public.announcements
  add column if not exists focus_linkup_categories text[] not null default '{}';
