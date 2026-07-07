-- Member timezone preference is retired: tee times and bookings always
-- display in the relevant course's own timezone (courses.timezone), never
-- a per-member preference. Chat/notification timestamps fall back to the
-- viewer's browser-detected zone instead.
alter table member_profiles
  drop column if exists timezone,
  drop column if exists latitude,
  drop column if exists longitude,
  drop column if exists location_updated_at;
