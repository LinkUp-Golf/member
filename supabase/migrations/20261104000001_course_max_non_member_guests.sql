-- How many non-member guests one booking may bring at this venue.
--
-- Where a venue takes non-member guests (allow_non_member_guests), a booking
-- was capped at one, fixed in code. The cap is now the venue's, set by an admin
-- beside that switch. 1 is the default, so every existing venue keeps the rule
-- it had.
--
-- Any number from 1 up: there is no ceiling of the app's own. A booking is
-- still bounded as a whole by the tee time's open spots, so a number above
-- what a tee time can seat simply never binds.
--
-- Read only while allow_non_member_guests is on; switching that off leaves the
-- number where it was, for when it's switched back on.
alter table courses
  add column if not exists max_non_member_guests integer not null default 1
    check (max_non_member_guests >= 1);
