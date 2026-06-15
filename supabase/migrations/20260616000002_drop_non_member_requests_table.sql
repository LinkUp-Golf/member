-- The original 20260616000001 migration created a non_member_booking_requests
-- table. That approach was replaced: non-member guests are now stored directly
-- as bookings in an 'awaiting_approval' state, moderated from /admin/booking-requests.
--
-- Databases that already applied the original 0001 (table creation) won't re-run
-- the rewritten 0001, so this migration: (1) drops the orphaned table, and
-- (2) ensures the 'awaiting_approval' enum value exists. Both are idempotent, so
-- this is also safe to run on a fresh database.

DROP TABLE IF EXISTS public.non_member_booking_requests CASCADE;

ALTER TYPE booking_status ADD VALUE IF NOT EXISTS 'awaiting_approval';
