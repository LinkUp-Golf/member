-- Communities, their Captains, and Captain approval of hosts at venues.
--
-- Release 1 of the community calendar (agreed with Greg, 2026-11-28). The
-- business is organised by community — San Diego today, many later — each with
-- one Captain and one Captain venue. Admins act in every community; a Captain
-- acts only in their own: approves its venues and hosts, and (from Release 2)
-- adds, changes and deletes any event at its venues. Rules:
-- src/lib/communities/permissions.ts.
--
-- Additive only. Nothing reads these columns yet, so existing screens behave
-- exactly as before.

-- ---- Communities ------------------------------------------------------------
create table if not exists communities (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  slug              text not null unique,
  timezone          text not null default 'America/Los_Angeles',
  -- The GHL membership tag that puts a member in this community
  -- (COMMUNITY_BY_TAG in src/lib/ghl/profile-fields.ts).
  membership_tag    text,
  captain_member_id uuid references members(id) on delete set null,
  captain_venue_id  uuid references courses(id) on delete set null,
  active            boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

drop trigger if exists communities_updated_at on communities;
create trigger communities_updated_at
  before update on communities
  for each row execute function update_updated_at();

alter table communities enable row level security;

-- Every signed-in member may read the list: it feeds the location filter on
-- the booking calendar and the member directory. Writes go through
-- service-role admin routes.
drop policy if exists "Read communities" on communities;
create policy "Read communities"
  on communities for select
  using (auth.uid() is not null);

-- ---- Venues belong to a community ------------------------------------------
alter table courses
  add column if not exists community_id uuid references communities(id) on delete set null;

create index if not exists courses_community_idx on courses (community_id);

-- ---- A host's venues are approved by the Captain ---------------------------
-- Every existing row was granted by an admin, so it starts approved; the
-- current code inserts rows only on approval, and the default keeps that true.
alter table host_venues
  add column if not exists status text not null default 'approved',
  add column if not exists approved_by uuid references members(id) on delete set null,
  add column if not exists approved_at timestamptz;

alter table host_venues drop constraint if exists host_venues_status_check;
alter table host_venues add constraint host_venues_status_check
  check (status in ('pending', 'approved', 'revoked'));

-- ---- San Diego ---------------------------------------------------------------
insert into communities (name, slug, timezone, membership_tag, captain_member_id, captain_venue_id)
select
  'San Diego',
  'san-diego',
  'America/Los_Angeles',
  'member-active-SD',
  (select id from members where lower(email) = 'greg@linkup.golf' limit 1),
  (select id from courses where name = 'Park Hyatt Aviara Golf Club' limit 1)
where not exists (select 1 from communities where slug = 'san-diego');

-- Every venue today is a San Diego venue.
update courses
set community_id = (select id from communities where slug = 'san-diego')
where community_id is null;
