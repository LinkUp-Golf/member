-- An invitation nobody answers expires 5 hours before the tee time.
--
-- The booking-invite-expiry cron marks such a row invite_status 'expired' and
-- cancels it, which frees the seat — a spot isn't held on the day of the round
-- for someone who never said yes. 'expired' is kept apart from 'declined' so
-- the booker and the admin list can tell "said no" from "never answered".
alter table bookings drop constraint if exists bookings_invite_status_check;
alter table bookings
  add constraint bookings_invite_status_check
  check (invite_status in ('pending', 'accepted', 'declined', 'expired'));

-- The cron's own query: unanswered invitations on near dates.
create index if not exists bookings_pending_invite_idx
  on bookings (booking_date)
  where invite_status = 'pending';
