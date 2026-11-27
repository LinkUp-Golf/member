-- Players an admin adds to a tee time by name.
--
-- An admin can put anyone on any tee time from /admin/bookings: a name, and an
-- email and phone if they have them. No member/guest choice, no venue guest
-- limit, no per-booking or per-day cap (src/lib/bookings/admin-players.ts,
-- POST /api/admin/bookings).
--
-- Each player is one booking row. A player with an account gets it as their
-- own round (member_id = them). A player with no account is a named seat
-- booked under the admin who added them (member_id = the admin, guest_name =
-- the player), because member_id can't be empty.
--
-- This column says an admin put the row there, and which one. It is what:
--   * keeps those named seats out of the admin's own My Bookings;
--   * lets /admin/bookings show each player by name alone, in a box of their
--     own, with no Guest / Invited / Booker label.
--
-- Nullable, no default: every existing row was booked by a member.

alter table bookings
  add column if not exists added_by_admin_id uuid references members(id) on delete set null;
