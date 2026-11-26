-- "Golfer Summary": how a member describes themselves as a golfer, in their
-- own words.
--
-- The profile had golf facts (handicap, play times, frequency) but nowhere to
-- say what kind of golfer someone is. The client asked for it on 2026-11-25:
-- it becomes the Golfer Summary of an Introduce Me introduction, and is shown
-- on the Curated Introductions admin screen. Both of those services will ask
-- for it before they start; the profile itself doesn't require it.
--
-- Plain text like the other profile prose, no length cap, nullable. Covered by
-- the existing member_profiles RLS: a member updates their own row.

alter table public.member_profiles
  add column if not exists golfer_description text;

comment on column public.member_profiles.golfer_description is
  'Golfer Summary: the member describing themselves as a golfer. Required by Introduce Me and Curated Introductions, not by the profile.';
