-- ============================================================
-- Member activity tracking — who uses the app, and where.
--
-- One row per tracked visit or action. Two write paths, both
-- server-side:
--   * POST /api/activity      — client page views (area/action
--                               validated against an allowlist)
--   * logActivity()           — API routes recording a real
--                               transaction (booking created, …)
--
-- `area` is deliberately free text rather than an enum or a
-- CHECK list: the allowlist lives in src/lib/activity/areas.ts
-- and is enforced at the API boundary. Pinning it here too would
-- mean a new area silently fails to insert until a migration
-- ships, and these writes are fire-and-forget — a rejected row
-- would vanish without anyone noticing.
-- ============================================================

create table if not exists member_activity_events (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references members(id) on delete cascade,
  -- Home course at the time of the event. Kept on the row so the
  -- report still groups correctly after a member changes course.
  course_id    uuid references courses(id) on delete set null,
  area         text not null,
  action       text not null,
  kind         text not null default 'view' check (kind in ('view', 'action')),
  -- What the event was about, when it has a subject: the promotion
  -- opened, the announcement read, the member whose profile was viewed.
  target_id    uuid,
  target_label text,
  path         text,
  metadata     jsonb not null default '{}',
  created_at   timestamptz not null default now()
);

-- The report reads by window first, then narrows. created_at leads
-- every index for that reason.
create index if not exists member_activity_created_idx
  on member_activity_events (created_at desc);
create index if not exists member_activity_member_idx
  on member_activity_events (member_id, created_at desc);
create index if not exists member_activity_area_idx
  on member_activity_events (area, created_at desc);
create index if not exists member_activity_target_idx
  on member_activity_events (area, target_id, created_at desc);

-- RLS: admins read, nobody writes through the anon/authenticated
-- roles. Inserts go through the service-role client in the API,
-- which is what stamps member_id from the session — a member must
-- not be able to write activity for someone else.
alter table member_activity_events enable row level security;

drop policy if exists "Admins can view member activity" on member_activity_events;
create policy "Admins can view member activity"
  on member_activity_events for select
  using (is_admin());

-- ============================================================
-- RPC: member_activity_rollup
-- One row per member — including members with no activity at all,
-- which is the half of the question ("who hasn't used the app")
-- an events-only query can't answer.
-- ============================================================

drop function if exists member_activity_rollup(timestamptz, timestamptz, text, text);

create function member_activity_rollup(
  p_from timestamptz,
  p_to   timestamptz,
  p_area text default null,
  p_kind text default null
)
returns table (
  member_id            uuid,
  first_name           text,
  last_name            text,
  email                text,
  membership_status    membership_status,
  is_admin             boolean,
  home_course_id       uuid,
  course_name          text,
  joined_at            timestamptz,
  last_sign_in         timestamptz,
  total_events         bigint,
  view_events          bigint,
  action_events        bigint,
  last_event_at        timestamptz,
  calendars_events     bigint,
  promotions_events    bigint,
  announcements_events bigint,
  directory_events     bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    m.id,
    m.first_name,
    m.last_name,
    m.email,
    m.membership_status,
    m.is_admin,
    m.home_course_id,
    c.name,
    m.created_at,
    m.last_sign_in,
    coalesce(a.total_events,         0),
    coalesce(a.view_events,          0),
    coalesce(a.action_events,        0),
    a.last_event_at,
    coalesce(a.calendars_events,     0),
    coalesce(a.promotions_events,    0),
    coalesce(a.announcements_events, 0),
    coalesce(a.directory_events,     0)
  from members m
  left join courses c on c.id = m.home_course_id
  left join lateral (
    select
      count(*)                                                 as total_events,
      count(*) filter (where e.kind = 'view')                  as view_events,
      count(*) filter (where e.kind = 'action')                as action_events,
      max(e.created_at)                                        as last_event_at,
      count(*) filter (where e.area = 'calendars')             as calendars_events,
      count(*) filter (where e.area = 'promotions')            as promotions_events,
      count(*) filter (where e.area = 'announcements')         as announcements_events,
      count(*) filter (where e.area = 'directory')             as directory_events
    from member_activity_events e
    where e.member_id   = m.id
      and e.created_at >= p_from
      and e.created_at <  p_to
      and (p_area is null or e.area = p_area)
      and (p_kind is null or e.kind = p_kind)
  ) a on true;
$$;

-- ============================================================
-- RPC: activity_area_breakdown
-- Visits vs actions vs reach, per area of the app.
--
-- Takes the same population filters as the roster above. Without
-- them the area cards would count admins and other courses while
-- the headline stats didn't, and the two halves of one screen
-- would disagree.
-- ============================================================

drop function if exists activity_area_breakdown(timestamptz, timestamptz, text);
drop function if exists activity_area_breakdown(timestamptz, timestamptz, text, uuid, text, boolean);

create function activity_area_breakdown(
  p_from           timestamptz,
  p_to             timestamptz,
  p_kind           text    default null,
  p_course_id      uuid    default null,
  p_status         text    default null,
  p_include_admins boolean default false
)
returns table (
  area           text,
  view_events    bigint,
  action_events  bigint,
  total_events   bigint,
  unique_members bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    e.area,
    count(*) filter (where e.kind = 'view')   as view_events,
    count(*) filter (where e.kind = 'action') as action_events,
    count(*)                                  as total_events,
    count(distinct e.member_id)               as unique_members
  from member_activity_events e
  join members m on m.id = e.member_id
  where e.created_at >= p_from
    and e.created_at <  p_to
    and (p_kind is null or e.kind = p_kind)
    and (p_course_id is null or m.home_course_id = p_course_id)
    and (p_status is null or m.membership_status::text = p_status)
    and (p_include_admins or not m.is_admin)
  group by e.area
  order by count(*) desc;
$$;

-- ============================================================
-- RPC: activity_daily_totals
-- Day-by-day trend over the same population. Gaps are days with
-- no activity — the caller fills them in rather than the query
-- generating a series, so a wide range stays cheap.
-- ============================================================

drop function if exists activity_daily_totals(timestamptz, timestamptz, text, text);
drop function if exists activity_daily_totals(timestamptz, timestamptz, text, text, uuid, text, boolean);

create function activity_daily_totals(
  p_from           timestamptz,
  p_to             timestamptz,
  p_area           text    default null,
  p_kind           text    default null,
  p_course_id      uuid    default null,
  p_status         text    default null,
  p_include_admins boolean default false
)
returns table (
  day            date,
  total_events   bigint,
  action_events  bigint,
  active_members bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    (e.created_at at time zone 'UTC')::date    as day,
    count(*)                                   as total_events,
    count(*) filter (where e.kind = 'action')  as action_events,
    count(distinct e.member_id)                as active_members
  from member_activity_events e
  join members m on m.id = e.member_id
  where e.created_at >= p_from
    and e.created_at <  p_to
    and (p_area is null or e.area = p_area)
    and (p_kind is null or e.kind = p_kind)
    and (p_course_id is null or m.home_course_id = p_course_id)
    and (p_status is null or m.membership_status::text = p_status)
    and (p_include_admins or not m.is_admin)
  group by 1
  order by 1;
$$;

-- All three are SECURITY DEFINER: they read every member's activity
-- regardless of the caller's RLS, which is the point of a report and
-- the reason they must not be reachable by a member. Called from the
-- admin route with the service-role client, behind
-- withAuth({ requireAdmin: true }).
revoke all on function member_activity_rollup(timestamptz, timestamptz, text, text)                       from public, anon, authenticated;
revoke all on function activity_area_breakdown(timestamptz, timestamptz, text, uuid, text, boolean)       from public, anon, authenticated;
revoke all on function activity_daily_totals(timestamptz, timestamptz, text, text, uuid, text, boolean)   from public, anon, authenticated;

grant execute on function member_activity_rollup(timestamptz, timestamptz, text, text)                     to service_role;
grant execute on function activity_area_breakdown(timestamptz, timestamptz, text, uuid, text, boolean)     to service_role;
grant execute on function activity_daily_totals(timestamptz, timestamptz, text, text, uuid, text, boolean) to service_role;
