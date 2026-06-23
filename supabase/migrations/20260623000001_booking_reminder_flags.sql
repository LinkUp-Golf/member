-- Track which timed reminders have been sent per booking row
alter table bookings
  add column if not exists reminder_7d_sent boolean not null default false,
  add column if not exists reminder_3d_sent boolean not null default false,
  add column if not exists reminder_6h_sent boolean not null default false;

-- Partial index so the cron only scans rows that still need work
create index if not exists bookings_pending_reminders_idx
  on bookings (booking_date)
  where
    status not in ('cancelled', 'waitlist') and (
      reminder_7d_sent = false or
      reminder_3d_sent = false or
      reminder_6h_sent = false
    );
