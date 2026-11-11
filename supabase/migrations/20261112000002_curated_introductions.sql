-- The matching survey becomes Curated Introductions: optional, and switched
-- on from More rather than demanded before the app opens.
--
-- open_to_suggestions now means "Curated Introductions is on" — in both
-- directions: a member with it off is neither introduced to anyone nor sent
-- introductions. A member who never filled the survey has no row, which reads
-- as off.
--
-- New answers:
--   industry            the member's own industry (the survey's list, which
--                       drops "Business Owner / Founder" — a role, not an
--                       industry — and has "Non-profit" where "Other" was).
--   role                the member's own role: founder, finance, marketing, …
--   meet_roles          roles they'd like to be introduced to (empty = any).
--   meet_company_sizes  ideal company sizes (empty or 'any' = any size).
--   skill               their own golf skill, self-described. Replaces the
--                       handicap as what the skill preference is checked
--                       against; a member who hasn't answered it is read from
--                       their handicap, as before.
--
-- client_industries is no longer asked ("What industries are your best
-- clients in?" became "What industry is your business in?"). The column is
-- left in place, unread.
-- ------------------------------------------------------------

alter table member_match_profiles
  add column if not exists industry            text,
  add column if not exists role                text,
  add column if not exists meet_roles          text[] not null default '{}',
  add column if not exists meet_company_sizes  text[] not null default '{}',
  add column if not exists skill               text;

-- Wanting to meet a "Business Owner / Founder" was wanting to meet a role.
update member_match_profiles
   set meet_roles = array_append(meet_roles, 'founder')
 where 'Business Owner / Founder' = any(meet_industries)
   and not ('founder' = any(meet_roles));

-- Neither is on the survey's industry list any more.
update member_match_profiles
   set meet_industries = array_remove(array_remove(meet_industries, 'Business Owner / Founder'), 'Other')
 where meet_industries && array['Business Owner / Founder', 'Other'];

-- A member whose profile industry is "Business Owner / Founder" is a founder.
update member_match_profiles mp
   set role = 'founder'
  from member_profiles p
 where p.id = mp.member_id
   and p.industry_category = 'Business Owner / Founder'
   and mp.role is null;

-- Gender is optional now, and "Prefer not to say" is gone: not answering is
-- how a member keeps it to themselves.
update member_match_profiles set gender = null where gender = 'undisclosed';
