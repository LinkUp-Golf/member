-- Per-course payment link, replacing the single app-wide payment URL.
-- Nullable at the DB level (existing courses need backfilling via the admin
-- form); the admin form and course create/update API routes enforce it going
-- forward. Backfill the two existing courses with the URL they already used
-- when it was a single shared constant, so live "Pay" links keep working.
ALTER TABLE courses
  ADD COLUMN IF NOT EXISTS payment_url text;

UPDATE courses
  SET payment_url = 'https://linkupgolf-services.com/aviara-event-booking-checkout-page'
  WHERE slug = 'aviara' AND payment_url IS NULL;
