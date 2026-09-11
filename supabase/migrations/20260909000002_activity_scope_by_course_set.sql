-- Let the utilization aggregates be scoped to a set of courses, not just one.
--
-- The report gains a community filter — the market a club sits in (San Diego
-- today), which is one or more courses rather than exactly one. The roster
-- could already be narrowed to a set in the API route, but the area cards and
-- the trend chart read these two RPCs, and both took a single uuid. Left as
-- they were, picking a community would have re-cut the roster while the
-- figures above it still described everybody — the exact disagreement the
-- p_course_id parameter was added to prevent.
--
-- So the parameter becomes p_course_ids uuid[]. A single course is an array of
-- one; null still means "every course", including members who have none.
--
-- DROP takes the grants with it, so they're re-issued at the bottom.

drop function if exists activity_area_breakdown(timestamptz, timestamptz, text, uuid, text, boolean);
drop function if exists activity_area_breakdown(timestamptz, timestamptz, text, uuid[], text, boolean);

create function activity_area_breakdown(
  p_from           timestamptz,
  p_to             timestamptz,
  p_kind           text    default null,
  p_course_ids     uuid[]  default null,
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
    and (p_course_ids is null or m.home_course_id = any(p_course_ids))
    and (p_status is null or m.membership_status::text = p_status)
    and (p_include_admins or not m.is_admin)
  group by e.area
  order by count(*) desc;
$$;

drop function if exists activity_daily_totals(timestamptz, timestamptz, text, text, uuid, text, boolean);
drop function if exists activity_daily_totals(timestamptz, timestamptz, text, text, uuid[], text, boolean);

create function activity_daily_totals(
  p_from           timestamptz,
  p_to             timestamptz,
  p_area           text    default null,
  p_kind           text    default null,
  p_course_ids     uuid[]  default null,
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
    and (p_course_ids is null or m.home_course_id = any(p_course_ids))
    and (p_status is null or m.membership_status::text = p_status)
    and (p_include_admins or not m.is_admin)
  group by 1
  order by 1;
$$;

-- SECURITY DEFINER: both read every member's activity regardless of the
-- caller's RLS, so they must stay unreachable by a member. Called from the
-- admin route with the service-role client, behind
-- withAuth({ requireAdmin: true }).
revoke all on function activity_area_breakdown(timestamptz, timestamptz, text, uuid[], text, boolean)     from public, anon, authenticated;
revoke all on function activity_daily_totals(timestamptz, timestamptz, text, text, uuid[], text, boolean) from public, anon, authenticated;

grant execute on function activity_area_breakdown(timestamptz, timestamptz, text, uuid[], text, boolean)     to service_role;
grant execute on function activity_daily_totals(timestamptz, timestamptz, text, text, uuid[], text, boolean) to service_role;
