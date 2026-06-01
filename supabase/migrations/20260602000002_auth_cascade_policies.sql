-- ============================================================
-- Auth cascade: make auth.users the source of truth.
-- Deleting an auth user cascades through members → all tables.
--
-- members → auth.users ON DELETE CASCADE already exists.
-- This migration fixes the remaining FK references on members(id)
-- that were missing cascade behaviour.
--
-- Ownership FKs  → ON DELETE CASCADE  (row is owned by the member)
-- Audit/ref FKs  → ON DELETE SET NULL (row survives; reference cleared)
-- ============================================================

-- ---- members.referred_by (self-referential) ------------------
alter table members
  drop constraint if exists members_referred_by_fkey;
alter table members
  add constraint members_referred_by_fkey
  foreign key (referred_by) references members(id) on delete set null;

-- ---- referrals -----------------------------------------------
alter table referrals
  drop constraint if exists referrals_referring_member_id_fkey;
alter table referrals
  add constraint referrals_referring_member_id_fkey
  foreign key (referring_member_id) references members(id) on delete cascade;

alter table referrals
  drop constraint if exists referrals_referred_member_id_fkey;
alter table referrals
  add constraint referrals_referred_member_id_fkey
  foreign key (referred_member_id) references members(id) on delete set null;

-- ---- conversations.created_by --------------------------------
-- Make nullable so SET NULL can be applied when creator is deleted.
alter table conversations
  alter column created_by drop not null;
alter table conversations
  drop constraint if exists conversations_created_by_fkey;
alter table conversations
  add constraint conversations_created_by_fkey
  foreign key (created_by) references members(id) on delete set null;

-- ---- messages.sender_id --------------------------------------
alter table messages
  drop constraint if exists messages_sender_id_fkey;
alter table messages
  add constraint messages_sender_id_fkey
  foreign key (sender_id) references members(id) on delete cascade;

-- ---- announcements -------------------------------------------
alter table announcements
  drop constraint if exists announcements_author_id_fkey;
alter table announcements
  add constraint announcements_author_id_fkey
  foreign key (author_id) references members(id) on delete cascade;

alter table announcements
  drop constraint if exists announcements_reviewed_by_fkey;
alter table announcements
  add constraint announcements_reviewed_by_fkey
  foreign key (reviewed_by) references members(id) on delete set null;

-- ---- member_events -------------------------------------------
alter table member_events
  drop constraint if exists member_events_organizer_id_fkey;
alter table member_events
  add constraint member_events_organizer_id_fkey
  foreign key (organizer_id) references members(id) on delete cascade;

alter table member_events
  drop constraint if exists member_events_reviewed_by_fkey;
alter table member_events
  add constraint member_events_reviewed_by_fkey
  foreign key (reviewed_by) references members(id) on delete set null;

-- ---- guest_access_requests -----------------------------------
alter table guest_access_requests
  drop constraint if exists guest_access_requests_requesting_member_id_fkey;
alter table guest_access_requests
  add constraint guest_access_requests_requesting_member_id_fkey
  foreign key (requesting_member_id) references members(id) on delete cascade;

alter table guest_access_requests
  drop constraint if exists guest_access_requests_reviewed_by_fkey;
alter table guest_access_requests
  add constraint guest_access_requests_reviewed_by_fkey
  foreign key (reviewed_by) references members(id) on delete set null;
