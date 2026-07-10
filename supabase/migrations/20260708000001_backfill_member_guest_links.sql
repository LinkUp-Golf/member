-- Backfill: link booking "guest" rows to member accounts when the guest's
-- email matches a registered member.
--
-- Context: a member added to a group booking is meant to be linked via
-- bookings.player_member_id (set when the booker picks them from member
-- search) so that member can see their own "payment due" badge/banner for
-- their own round, and the booker gets a "message" shortcut to them. Some
-- legacy rows were created with a fellow member added as a NON-member guest
-- instead (guest_name + additional_players[].email, player_member_id null,
-- isNonMember true) — from before /api/bookings/create started rejecting a
-- member's email added as a guest. Those members had no link to the booking
-- and so saw no badge/banner for their round.
--
-- This links every such row to the matching member and marks the additional
-- player as a member. Idempotent: only rows still missing player_member_id are
-- touched, so re-running is a no-op. Each booking row carries exactly one
-- additional player (one row per player — see the create route), so index 0 is
-- the matching element.
update bookings b
set player_member_id = m.id,
    additional_players = jsonb_set(
      jsonb_set(b.additional_players, '{0,isNonMember}', 'false'::jsonb),
      '{0,memberId}', to_jsonb(m.id::text)
    )
from members m
where b.player_member_id is null
  and jsonb_array_length(b.additional_players) = 1
  and lower(b.additional_players->0->>'email') = lower(m.email);
