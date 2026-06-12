-- Link a guest booking row to the specific member who is playing.
-- member_id remains the booker (for group visibility); player_member_id
-- points to the guest member so they can query their own involvement.
alter table public.bookings
  add column if not exists player_member_id uuid references public.members(id) on delete set null;

create index if not exists bookings_player_member_id_idx on public.bookings(player_member_id);
