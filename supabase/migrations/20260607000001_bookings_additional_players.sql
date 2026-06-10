-- Store additional player details for multi-player bookings.
-- Each element: { firstName, lastName, mobile, email }
alter table public.bookings
  add column if not exists additional_players jsonb not null default '[]'::jsonb;
