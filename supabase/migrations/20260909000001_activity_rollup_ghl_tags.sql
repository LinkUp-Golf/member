-- Carry each member's GHL tags through the utilization rollup.
--
-- The report can already be cut by course and by engagement, but not by what
-- GHL actually knows about a person — which membership they hold, whether they
-- came in as a member's guest, which campaign they arrived on. Those live in
-- members.ghl_tags, synced from the contact on login, webhook and the daily
-- reconcile.
--
-- Passed through as the jsonb it's stored as, rather than unpacked into
-- text[]: the column is only an array of strings by convention, and
-- jsonb_array_elements_text on a row that isn't one would fail the whole
-- report rather than that member's tags. The caller normalises.
--
-- Returned rather than filtered here: the roster's own filters (search,
-- engagement, tag) are applied in the API route over the same rows, so one
-- pass over members answers all of them. The signature is unchanged — only the
-- returned columns grow — so callers that ignore the new column keep working.
--
-- DROP takes the grants with it, so they're re-issued at the bottom.

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
  ghl_tags             jsonb,
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
    coalesce(m.ghl_tags, '[]'::jsonb),
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

-- SECURITY DEFINER: reads every member's activity regardless of the caller's
-- RLS, so it must stay unreachable by a member. Called from the admin route
-- with the service-role client, behind withAuth({ requireAdmin: true }).
revoke all on function member_activity_rollup(timestamptz, timestamptz, text, text) from public, anon, authenticated;
grant execute on function member_activity_rollup(timestamptz, timestamptz, text, text) to service_role;
