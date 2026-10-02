-- A round a member was brought along on is their round.
--
-- A booking has been one row per player since 20260612 — the booker, each
-- member added by name, each non-member guest — and bookings.player_member_id
-- is what says whose seat a row is. GET /api/bookings reads exactly that:
--   .or(member_id.eq.<me>, player_member_id.eq.<me>)
-- so a row without it belongs to nobody but the booker.
--
-- Non-member guests fell through that. POST /api/bookings/create provisions
-- them a GHL contact, the access tags and a LinkUp member row (see
-- src/lib/bookings/non-member-guest.ts) — they can sign in — and then left the
-- booking row saying only guest_name. So the one person for whom the app is new
-- opened it to no rounds at all, while their name sat on somebody else's
-- booking. The route now writes the link as it provisions (linkGuestToMember);
-- this is every row it already created.
--
-- Same rule as 20260708000001, which did this once for a different cause (a
-- fellow member added as a non-member guest, from before the route rejected
-- that). It has needed doing continuously ever since, so it's worth saying the
-- rule out loud: a row naming exactly one additional player whose email is a
-- member's email is that member's row. Idempotent — only rows still missing the
-- link are touched — so this runs again whenever it's needed.
--
-- What this CANNOT fix, and why there's no attempt: a booking made before
-- 20260612 is a single row with players = N and no additional_players at all.
-- Nothing recorded who those N people were — one free-text guest_name for the
-- lot — so there is no player to give a row to. Those rounds stay as they are.
-- ------------------------------------------------------------

update bookings b
set player_member_id = m.id,
    additional_players = jsonb_set(
      jsonb_set(b.additional_players, '{0,isNonMember}', 'false'::jsonb),
      '{0,memberId}', to_jsonb(m.id::text)
    )
from members m
where b.player_member_id is null
  and jsonb_array_length(b.additional_players) = 1
  and lower(b.additional_players->0->>'email') = lower(m.email)
  -- Never the booker themselves. A booker who typed their own address in as a
  -- guest would otherwise end up invited to their own round, and the client
  -- reads "the row whose player_member_id is me" as the seat to show as "You".
  and m.id <> b.member_id;

-- ---- RLS: the link is readable by the person it names -------------------
--
-- The select policy let a member read a booking because they belong to that
-- course, which covers the ordinary case and not this one: a guest brought to a
-- club they have no membership at, or a member whose access tag is removed
-- later, could hold a seat in a round they cannot read. Being named on the row
-- is its own reason, and it's the narrowest possible one — it grants that
-- member their own seat and nothing else.
drop policy if exists "Members can view bookings in their communities" on bookings;

create policy "Members can view bookings in their communities"
  on bookings for select
  using (
    member_id = auth.uid()
    or player_member_id = auth.uid()
    or course_id = any(get_member_course_ids(auth.uid()))
    or is_admin()
  );
