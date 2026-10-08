-- Pinging the players from a member's cancelled rounds.
--
-- When a member cancels and books again, the people who were on the cancelled
-- round are recommended on the new one, and the booker can ping them — a direct
-- message saying "I'm playing on this date, come along". One row per booking
-- per member pinged: it's what stops the same person being pinged twice about
-- the same round, and what the route counts so the pings outstanding on a round
-- never exceed the spots the day has open.
--
-- kind 'invite' records a player the booker added to the round outright (the
-- add-players route holds the spot; this row only records that the message
-- went out), 'ping' one they asked to come and book.
CREATE TABLE IF NOT EXISTS booking_player_pings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id  uuid NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  member_id   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  pinged_by   uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind        text NOT NULL DEFAULT 'ping' CHECK (kind IN ('ping', 'invite')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id, member_id)
);

CREATE INDEX IF NOT EXISTS booking_player_pings_booking_idx ON booking_player_pings (booking_id);

-- Written only by the route, through the service role. The booker may read the
-- pings they sent.
ALTER TABLE booking_player_pings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Booker can view their pings" ON booking_player_pings;
CREATE POLICY "Booker can view their pings"
  ON booking_player_pings FOR SELECT
  USING (pinged_by = auth.uid());
