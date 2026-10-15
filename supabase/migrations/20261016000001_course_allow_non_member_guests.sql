-- Whether a member may bring a non-member guest to this venue.
--
-- A booker can add players to a round — fellow members by name, or a
-- non-member by email and phone, who is then provisioned a GHL contact and a
-- member row of their own (src/lib/bookings/non-member-guest.ts). That second
-- kind now needs the venue's say-so: an admin turns it on per course.
--
-- Off by default, and existing courses are switched off with it. Adding a
-- fellow member is unaffected either way.
alter table courses
  add column if not exists allow_non_member_guests boolean not null default false;
