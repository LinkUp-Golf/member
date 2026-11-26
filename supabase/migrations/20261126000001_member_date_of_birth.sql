-- Date of birth, for Curated Introductions matching (2026-11-26).
--
-- Kept beside gender in member_match_profiles, which has RLS on and no
-- policies: only the service role reads it, and it's never shown to another
-- member. It's synced both ways with GoHighLevel's standard Date of Birth
-- field. "Prefer not to say" can't be held in a date, so it's its own flag and
-- GoHighLevel's field is left blank for it.
--
-- Gender needs no column change: it's already text here, and "prefer_not"
-- (GoHighLevel tag gender-pns) is a new value alongside male / female.
--
-- A member can now set either on their profile before turning Curated
-- Introductions on. Such a row is created with open_to_suggestions = false and
-- completed_at null, so it reads exactly as "never turned on".

alter table public.member_match_profiles
  add column if not exists date_of_birth  date,
  add column if not exists dob_prefer_not boolean not null default false;

comment on column public.member_match_profiles.date_of_birth is
  'Private; matching only. Synced with GoHighLevel''s standard Date of Birth field.';
comment on column public.member_match_profiles.dob_prefer_not is
  'Member chose "Prefer not to say" for date of birth. GoHighLevel''s field stays blank.';
