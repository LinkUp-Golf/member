-- Playing partner matching (docs/playing-partner-matching.md).
--
-- Two halves. member_match_profiles holds the survey every member completes
-- before using the app: the networking pick-lists, their own golf attitude and
-- habits, and their golf preferences about the people they play with. And
-- play_suggestions, left over from the removed weekly job, becomes the record
-- of a recommendation an admin sent: who sent it, the note on why, and whether
-- the member has seen it.
--
-- Nothing here is automatic. An admin opens a member, the app lists the
-- players who fit them, and the admin chooses who to recommend.

-- ---- Survey answers -----------------------------------------
--
-- Server-only: RLS on, no policies. Gender, the smoke / music / booze answers
-- and the preferences decide who a member can be recommended to, and must
-- never be readable by another member — they're read through the service role
-- behind withAuth, and only an admin route shows them.
--
-- The free-text half of the survey (what they offer and seek, hobbies,
-- non-profits, handicap) stays on member_profiles, where it already was.
--
-- Values are validated at the API boundary (src/lib/matching/survey.ts), the
-- same way member_activity_events.area is, so an added option needs no
-- migration.
create table if not exists member_match_profiles (
  member_id             uuid primary key references members(id) on delete cascade,

  -- Networking profile
  goals                 text[] not null default '{}',
  meet_industries       text[] not null default '{}',
  client_industries     text[] not null default '{}',
  client_company_sizes  text[] not null default '{}',
  company_size          text,
  play_times            text[] not null default '{}',
  attitude              text,

  -- About the member, which other members' preferences are checked against
  gender                text,
  does_cigars           boolean,
  does_cigarettes       boolean,
  does_marijuana        boolean,
  does_alcohol          boolean,
  does_music            boolean,

  -- Golf preferences
  pref_gender           text,
  pref_skill            text,
  pref_attitude         text,
  minds_cigars          boolean,
  minds_cigarettes      boolean,
  minds_marijuana       boolean,
  minds_alcohol         boolean,
  minds_music           boolean,

  -- "Suggest me to other members". On by default: the survey is mandatory,
  -- and the toggle is how a member steps out of the pool, not into it.
  open_to_suggestions   boolean not null default true,

  -- Set the first time the survey is submitted whole. The gate in the member
  -- app reads it, and the admin queue orders by it.
  completed_at          timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists member_match_profiles_completed_idx
  on member_match_profiles (completed_at desc)
  where completed_at is not null;

alter table member_match_profiles enable row level security;

-- ---- Recommendations ----------------------------------------
--
-- One row per (member, suggested member), as before: re-sending a pair the
-- member dismissed long ago updates the row rather than adding one.
alter table play_suggestions
  add column if not exists recommended_by uuid references members(id) on delete set null,
  add column if not exists note           text,
  add column if not exists seen_at        timestamptz;

create index if not exists play_suggestions_suggested_created_idx
  on play_suggestions (suggested_id, created_at desc);

-- The original policy let a member insert and edit their own rows, which was
-- harmless while nothing showed them to anyone. A row now reads as "the
-- LinkUp team recommends…", so a member may only read theirs; dismissing goes
-- through POST /api/recommendations/[id]/dismiss with the service role.
drop policy if exists "Members manage own suggestions" on play_suggestions;
create policy "Members read own suggestions"
  on play_suggestions for select
  using (member_id = auth.uid());
