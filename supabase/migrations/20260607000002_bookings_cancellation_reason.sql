-- Store member-provided reason when a booking is cancelled.
alter table public.bookings
  add column if not exists cancellation_reason text;
