-- Booking pipeline integration: Avi-Play GHL pipeline support
-- Adds ghl_opportunity_id and expands status enum to cover the full pipeline stages.

-- Add GHL opportunity ID column (stores the Avi-Play pipeline opportunity ID)
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS ghl_opportunity_id TEXT;

-- Extend the booking_status enum with the full set of pipeline stages.
-- ADD VALUE IF NOT EXISTS is safe to re-run.
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'tentative';
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'availability_confirmed';
ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'payment_confirmed';

-- Index for fast opportunity lookups (e.g. cancel flow)
CREATE INDEX IF NOT EXISTS idx_bookings_ghl_opportunity_id
  ON bookings (ghl_opportunity_id)
  WHERE ghl_opportunity_id IS NOT NULL;

-- Index for per-member upcoming tentative bookings (admin FIFO view)
CREATE INDEX IF NOT EXISTS idx_bookings_member_status_date
  ON bookings (member_id, status, booking_date);
