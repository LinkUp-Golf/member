-- Dinner RSVP is a checkbox, not a three-way answer.
--
-- 'maybe' was never actionable: the venue either holds a seat at the group
-- table or it doesn't, and an admin chasing a maybe was doing by hand what the
-- member could have said in one tap. So the member app now asks one yes/no
-- question and the column becomes the boolean it always described.
--
-- 'maybe' converts to true. A seat held for someone who doesn't come costs the
-- group nothing; a seat missing for someone who does is the failure worth
-- avoiding.
--
-- NULL survives the conversion and keeps meaning "never answered" — bookings
-- made before the prompt existed, and every booking at a venue that doesn't
-- run a group table.

ALTER TABLE bookings
  DROP CONSTRAINT IF EXISTS bookings_dinner_rsvp_check;

ALTER TABLE bookings
  ALTER COLUMN dinner_rsvp TYPE boolean
  USING (
    CASE
      WHEN dinner_rsvp IS NULL THEN NULL
      WHEN dinner_rsvp = 'no'  THEN false
      ELSE true
    END
  );
