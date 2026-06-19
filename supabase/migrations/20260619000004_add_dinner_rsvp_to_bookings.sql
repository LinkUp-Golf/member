-- Track per-member dinner RSVP on bookings
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS dinner_rsvp text
    CHECK (dinner_rsvp IN ('yes', 'no', 'maybe'));
