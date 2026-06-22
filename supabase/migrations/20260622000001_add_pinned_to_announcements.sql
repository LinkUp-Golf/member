-- Add is_pinned flag to announcements
alter table announcements
  add column if not exists is_pinned boolean not null default false;

-- Efficient ordering: pinned first, then by recency
create index if not exists announcements_course_pinned_date_idx
  on announcements (course_id, is_pinned desc, published_at desc);
